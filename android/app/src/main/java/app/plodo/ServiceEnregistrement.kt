package app.plodo

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.MediaRecorder
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Le service qui enregistre.
 *
 * C'est lui, et lui seul, qui rend le mode discrétion possible. Une page web ne
 * survit pas à un écran qui s'éteint : Android suspend l'onglet, les minuteurs
 * ralentissent, la capture finit par s'arrêter. Un service au premier plan de
 * type « microphone », lui, continue — c'est le contrat explicite d'Android, en
 * échange d'une notification visible.
 *
 * Trois déclencheurs atteignent ce service écran verrouillé :
 *   1. le bouton de la notification, sur l'écran de verrouillage ;
 *   2. la tuile « Point clé » des réglages rapides ;
 *   3. le bouton d'un casque ou d'écouteurs Bluetooth (via MediaSession).
 */
class ServiceEnregistrement : Service() {

    private var recorder: MediaRecorder? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var session: MediaSession? = null

    private lateinit var reglages: Reglages
    private var dossier: File? = null
    private var identifiant: String = ""
    private var titre: String = ""

    private var debutHorloge = 0L      // SystemClock.elapsedRealtime au dernier démarrage
    private var cumul = 0.0            // secondes accumulées hors pauses
    private val points = mutableListOf<PointCle>()

    private val battement = Handler(Looper.getMainLooper())
    private val tic = object : Runnable {
        override fun run() {
            Etat.publierSecondes(position())
            battement.postDelayed(this, 1000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        reglages = Reglages(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DEMARRER -> demarrer(intent.getStringExtra(EXTRA_TITRE).orEmpty())
            ACTION_MARQUER -> marquer()
            ACTION_BASCULER_PAUSE -> basculerPause()
            ACTION_ARRETER -> arreter()
        }
        return START_STICKY
    }

    /** Secondes écoulées, pauses déduites. */
    private fun position(): Double =
        if (Etat.capture.value == EtatCapture.ENREGISTRE)
            cumul + (SystemClock.elapsedRealtime() - debutHorloge) / 1000.0
        else cumul

    // ------------------------------------------------------------- démarrage

    private fun demarrer(titreSaisi: String) {
        if (Etat.capture.value != EtatCapture.REPOS) return

        val maintenant = Date()
        identifiant = "v" + SimpleDateFormat("yyyyMMddHHmmss", Locale.FRANCE).format(maintenant) +
            "-" + (1000..9999).random()
        titre = titreSaisi.ifBlank {
            "Visite du " + SimpleDateFormat("d MMMM", Locale.FRANCE).format(maintenant)
        }

        val racine = File(getExternalFilesDir(null), "visites")
        dossier = File(racine, identifiant).apply { mkdirs() }

        recorder = nouveauRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            // 16 kHz mono : exactement ce qu'attend Whisper, et environ 15 Mo
            // pour une heure. Enregistrer plus large ne ferait que gonfler le
            // fichier sans rien apporter à la transcription.
            setAudioSamplingRate(16000)
            setAudioChannels(1)
            setAudioEncodingBitRate(32000)
            setOutputFile(File(dossier, "audio.m4a").absolutePath)
            prepare()
            start()
        }

        cumul = 0.0
        debutHorloge = SystemClock.elapsedRealtime()
        points.clear()

        // Sans ce verrou, le processeur s'endort avec l'écran et la capture cale.
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "plodo:capture")
            .apply { setReferenceCounted(false); acquire(12 * 60 * 60 * 1000L) }

        ouvrirSessionMedia()

        Etat.publierTitre(titre)
        Etat.publierPoints(emptyList())
        Etat.publierCapture(EtatCapture.ENREGISTRE)
        battement.post(tic)

        startForeground(NOTIF_ID, notification())
    }

    private fun nouveauRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this)
        else @Suppress("DEPRECATION") MediaRecorder()

    // ------------------------------------------------------------ point clé

    private fun marquer() {
        if (Etat.capture.value == EtatCapture.REPOS) return
        val t = Math.round(position() * 10) / 10.0
        points += PointCle(t, "Point clé ${points.size + 1}")
        Etat.publierPoints(points.toList())

        // Le seul retour, et c'est voulu : rien ne s'allume, rien ne sonne.
        vibrer(longArrayOf(0, 25, 60, 25))
        rafraichirNotification()
    }

    private fun vibrer(motif: LongArray) {
        val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            getSystemService(VibratorManager::class.java).defaultVibrator
        else @Suppress("DEPRECATION") getSystemService(Vibrator::class.java)
        vib?.vibrate(VibrationEffect.createWaveform(motif, -1))
    }

    // --------------------------------------------------------------- pause

    private fun basculerPause() {
        when (Etat.capture.value) {
            EtatCapture.ENREGISTRE -> {
                recorder?.pause()
                cumul = position()
                Etat.publierCapture(EtatCapture.PAUSE)
                battement.removeCallbacks(tic)
            }
            EtatCapture.PAUSE -> {
                recorder?.resume()
                debutHorloge = SystemClock.elapsedRealtime()
                Etat.publierCapture(EtatCapture.ENREGISTRE)
                battement.post(tic)
            }
            EtatCapture.REPOS -> return
        }
        vibrer(longArrayOf(0, 18))
        rafraichirNotification()
    }

    // --------------------------------------------------------------- arrêt

    private fun arreter() {
        if (Etat.capture.value == EtatCapture.REPOS) return
        val duree = position()

        battement.removeCallbacks(tic)
        runCatching { recorder?.stop() }
        recorder?.release()
        recorder = null

        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        session?.apply { isActive = false; release() }
        session = null

        ecrireFiche(duree)

        Etat.publierSecondes(duree)
        Etat.publierCapture(EtatCapture.REPOS)
        Etat.dire("Visite enregistrée : ${hms(duree)}, ${points.size} point(s) clé(s).")

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * La fiche accompagne l'audio dans le même dossier. Elle suffit à reconstruire
     * la visite si la synchronisation n'a jamais lieu — le dossier se copie à la
     * main dans data/visites/ du poste, et rien n'est perdu.
     */
    private fun ecrireFiche(duree: Double) {
        val tableau = JSONArray()
        points.forEach { tableau.put(JSONObject().put("t", it.t).put("label", it.libelle)) }

        val fiche = JSONObject()
            .put("id", identifiant)
            .put("titre", titre)
            .put("date", SimpleDateFormat("yyyy-MM-dd", Locale.FRANCE).format(Date()))
            .put("duree", Math.round(duree))
            .put("statut", "en_cours")
            .put("markers", tableau)

        File(dossier, "visite.json").writeText(fiche.toString(2))
    }

    // -------------------------------------------------------- notification

    private fun action(icone: Int, titre: String, quoi: String): NotificationCompat.Action {
        val intent = Intent(this, ServiceEnregistrement::class.java).setAction(quoi)
        val pending = PendingIntent.getService(
            this, quoi.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Action.Builder(icone, titre, pending).build()
    }

    private fun notification(): Notification {
        val enPause = Etat.capture.value == EtatCapture.PAUSE
        val discret = reglages.discretion

        val ouvrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val sousTitre = when {
            // En mode discrétion, la notification ne raconte rien : ni le titre de
            // la visite, ni la durée. Quelqu'un qui regarde par-dessus l'épaule ne
            // lit qu'« Enregistrement ».
            discret && enPause -> "En pause"
            discret -> "En cours"
            enPause -> "En pause · ${hms(position())} · ${points.size} point(s) clé(s)"
            else -> "${hms(position())} · ${points.size} point(s) clé(s)"
        }

        return NotificationCompat.Builder(this, PlodoApp.CANAL)
            .setSmallIcon(R.drawable.ic_micro)
            .setContentTitle(if (discret) "Enregistrement" else titre)
            .setContentText(sousTitre)
            .setContentIntent(ouvrir)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(
                if (reglages.masquerSurVerrouillage) NotificationCompat.VISIBILITY_SECRET
                else NotificationCompat.VISIBILITY_PUBLIC
            )
            .addAction(action(R.drawable.ic_point_cle, getString(R.string.point_cle), ACTION_MARQUER))
            .addAction(
                if (enPause) action(R.drawable.ic_lancer, "Reprendre", ACTION_BASCULER_PAUSE)
                else action(R.drawable.ic_pause, "Pause", ACTION_BASCULER_PAUSE)
            )
            .addAction(action(R.drawable.ic_stop, "Arrêter", ACTION_ARRETER))
            .build()
    }

    private fun rafraichirNotification() {
        if (Etat.capture.value == EtatCapture.REPOS) return
        getSystemService(android.app.NotificationManager::class.java)
            .notify(NOTIF_ID, notification())
    }

    // ------------------------------------------------------- bouton casque

    /**
     * Une session média active capte les touches du casque même écran éteint.
     * « Piste suivante » devient « point clé » : un appui sur le fil, et le
     * repère est posé sans sortir le téléphone de la poche.
     */
    private fun ouvrirSessionMedia() {
        session = MediaSession(this, "plodo").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onMediaButtonEvent(intent: Intent): Boolean {
                    val touche = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)

                    if (touche?.action != KeyEvent.ACTION_DOWN) return true
                    when (touche.keyCode) {
                        KeyEvent.KEYCODE_MEDIA_NEXT,
                        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
                        KeyEvent.KEYCODE_HEADSETHOOK -> marquer()
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                        KeyEvent.KEYCODE_MEDIA_PAUSE,
                        KeyEvent.KEYCODE_MEDIA_PLAY -> basculerPause()
                        KeyEvent.KEYCODE_MEDIA_STOP -> arreter()
                    }
                    return true
                }
            })
            setPlaybackState(
                PlaybackState.Builder()
                    .setActions(
                        PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or
                            PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_STOP
                    )
                    .setState(PlaybackState.STATE_PLAYING, 0, 1f)
                    .build()
            )
            isActive = true
        }
    }

    override fun onDestroy() {
        battement.removeCallbacks(tic)
        wakeLock?.let { if (it.isHeld) it.release() }
        session?.release()
        super.onDestroy()
    }

    companion object {
        const val ACTION_DEMARRER = "app.plodo.DEMARRER"
        const val ACTION_MARQUER = "app.plodo.MARQUER"
        const val ACTION_BASCULER_PAUSE = "app.plodo.PAUSE"
        const val ACTION_ARRETER = "app.plodo.ARRETER"
        const val EXTRA_TITRE = "titre"
        private const val NOTIF_ID = 1

        fun envoyer(context: Context, quoi: String, titre: String? = null) {
            val intent = Intent(context, ServiceEnregistrement::class.java)
                .setAction(quoi)
                .apply { titre?.let { putExtra(EXTRA_TITRE, it) } }
            if (quoi == ACTION_DEMARRER) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }
}
