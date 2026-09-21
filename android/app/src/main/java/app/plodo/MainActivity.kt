package app.plodo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/* ---------------------------------------------------------------- palette */
// Les mêmes valeurs que web/styles/tokens.css : un seul thème, deux supports.
private val FondVide = Color(0xFF050509)
private val FondPanneau = Color(0xFF101019)
private val FondRelief = Color(0xFF16161F)
private val Trait = Color(0x12FFFFFF)
private val TraitQuartz = Color(0x598B7CF0)
private val Quartz = Color(0xFF8B7CF0)
private val QuartzClair = Color(0xFFB9ADFB)
private val Encre1 = Color(0xFFF3F2FB)
private val Encre2 = Color(0xFFA9A7C0)
private val Encre3 = Color(0xFF71708A)
private val Critique = Color(0xFFD03B3B)
private val Nebuleuse = Color(0xFF5FD4C4)

/** Adresse à utiliser quand Plodo tourne dans Termux, sur ce même téléphone. */
private const val LOCAL_TERMUX = "http://127.0.0.1:7331"

class MainActivity : ComponentActivity() {

    private val demandeDroits = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { accords ->
        if (accords[Manifest.permission.RECORD_AUDIO] == false) {
            Etat.dire("Sans accès au micro, Plodo ne peut rien enregistrer.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reclamerDroits()
        setContent { Ecran(Reglages(this)) }
    }

    private fun reclamerDroits() {
        val manquants = buildList {
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
            ) add(Manifest.permission.RECORD_AUDIO)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (manquants.isNotEmpty()) demandeDroits.launch(manquants.toTypedArray())
    }
}

/* ------------------------------------------------------------------ écran */

@Composable
private fun Ecran(reglages: Reglages) {
    val contexte = LocalContext.current
    val etendue = rememberCoroutineScope()

    val capture by Etat.capture.collectAsStateWithLifecycle()
    val secondes by Etat.secondes.collectAsStateWithLifecycle()
    val points by Etat.points.collectAsStateWithLifecycle()
    val message by Etat.message.collectAsStateWithLifecycle()

    var titre by remember { mutableStateOf("") }
    var poste by remember { mutableStateOf(reglages.poste) }
    var discretion by remember { mutableStateOf(reglages.discretion) }
    var masquer by remember { mutableStateOf(reglages.masquerSurVerrouillage) }
    var enAttente by remember { mutableStateOf(visitesLocales(contexte)) }
    var envoiEnCours by remember { mutableStateOf(false) }

    // Une visite qui vient de s'arrêter doit apparaître aussitôt dans la file.
    LaunchedEffect(capture) { if (capture == EtatCapture.REPOS) enAttente = visitesLocales(contexte) }

    val etatBandeau = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        message?.let { etatBandeau.showSnackbar(it); Etat.dire(null) }
    }

    MaterialTheme(colorScheme = darkColorScheme(primary = Quartz, background = FondVide)) {
        Scaffold(
            containerColor = FondVide,
            snackbarHost = { SnackbarHost(etatBandeau) }
        ) { marges ->
            Column(
                modifier = Modifier
                    .padding(marges)
                    .fillMaxSize()
                    .background(
                        // La nébuleuse du thème, en une seule passe.
                        Brush.verticalGradient(
                            listOf(Color(0xFF16122B), FondVide, Color(0xFF0A1A18)),
                            startY = 0f, endY = 2600f
                        )
                    )
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                Marque()

                Capsule(capture, secondes, points.size,
                    onBasculer = {
                        if (capture == EtatCapture.REPOS)
                            ServiceEnregistrement.envoyer(contexte, ServiceEnregistrement.ACTION_DEMARRER, titre)
                        else
                            ServiceEnregistrement.envoyer(contexte, ServiceEnregistrement.ACTION_ARRETER)
                    },
                    onPointCle = {
                        ServiceEnregistrement.envoyer(contexte, ServiceEnregistrement.ACTION_MARQUER)
                    },
                    onPause = {
                        ServiceEnregistrement.envoyer(contexte, ServiceEnregistrement.ACTION_BASCULER_PAUSE)
                    }
                )

                if (capture == EtatCapture.REPOS) {
                    Panneau("Contexte") {
                        Champ(titre, { titre = it }, "Intitulé", "Visite chaufferie — lot CVC")
                    }
                } else {
                    Panneau("Points clés posés", "${points.size}") {
                        if (points.isEmpty()) {
                            Text("Aucun repère. Appuyez sur Point clé, sur la tuile des réglages rapides, ou sur le bouton du casque.",
                                color = Encre3, fontSize = 13.sp)
                        } else {
                            points.asReversed().take(8).forEach {
                                Row(verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    modifier = Modifier.padding(vertical = 3.dp)) {
                                    Text(hms(it.t), color = QuartzClair, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                                    Text(it.libelle, color = Encre2, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }

                PanneauDiscretion(discretion, masquer,
                    onDiscretion = { discretion = it; reglages.discretion = it },
                    onMasquer = { masquer = it; reglages.masquerSurVerrouillage = it })

                Panneau("Poste de travail") {
                    Champ(poste, { poste = it; reglages.poste = it }, "Adresse", "http://192.168.1.20:7331")
                    Text(
                        "Lancez Plodo sur l'ordinateur avec PLODO_HOST=0.0.0.0 pour qu'il accepte le réseau local.",
                        color = Encre3, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)
                    )
                    Row(
                        Modifier.fillMaxWidth().padding(top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Ce préréglage n'a de sens que si Plodo tourne aussi sur ce
                        // téléphone, dans Termux : voir docs/ANDROID.md « Autonomie complète ».
                        // Sans ça, 127.0.0.1 pointe sur rien et l'envoi échouera proprement.
                        TextButton(onClick = { poste = LOCAL_TERMUX; reglages.poste = LOCAL_TERMUX }) {
                            Text("Ce téléphone (Termux)", color = QuartzClair, fontSize = 12.sp)
                        }
                    }
                }

                Panneau("À envoyer", "${enAttente.size}") {
                    if (enAttente.isEmpty()) {
                        Text("Rien en attente.", color = Encre3, fontSize = 13.sp)
                    } else {
                        enAttente.forEach { visite ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(visite.titre, color = Encre1, fontSize = 14.sp)
                                    Text("${hms(visite.duree)} · ${visite.points} point(s) clé(s) · ${visite.mo} Mo",
                                        color = Encre3, fontSize = 12.sp)
                                }
                                TextButton(
                                    enabled = !envoiEnCours && poste.isNotBlank(),
                                    onClick = {
                                        envoiEnCours = true
                                        etendue.launch {
                                            val bilan = withContext(Dispatchers.IO) {
                                                runCatching { Sync.envoyer(poste, visite.dossier) }
                                            }
                                            envoiEnCours = false
                                            bilan.onSuccess {
                                                visite.dossier.deleteRecursively()
                                                enAttente = visitesLocales(contexte)
                                                Etat.dire("Envoyée au poste.")
                                            }.onFailure { Etat.dire(it.message ?: "Envoi impossible.") }
                                        }
                                    }
                                ) { Text("Envoyer", color = QuartzClair) }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/* ------------------------------------------------------------ composants */

@Composable
private fun Marque() {
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            Modifier.size(34.dp).clip(RoundedCornerShape(10.dp))
                .background(Brush.linearGradient(listOf(Quartz, Color(0xFF241D4D)))),
            contentAlignment = Alignment.Center
        ) { Text("◈", color = Encre1, fontSize = 16.sp) }
        Column {
            Text("Plodo", color = Encre1, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Text("QUARTZ GALAXIE NOIR", color = Encre3, fontSize = 10.sp)
        }
    }
}

@Composable
private fun Capsule(
    capture: EtatCapture, secondes: Double, nbPoints: Int,
    onBasculer: () -> Unit, onPointCle: () -> Unit, onPause: () -> Unit
) {
    CadrePanneau {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            val (libelle, teinte) = when (capture) {
                EtatCapture.REPOS -> "AU REPOS" to Encre3
                EtatCapture.ENREGISTRE -> "ENREGISTREMENT" to Critique
                EtatCapture.PAUSE -> "EN PAUSE" to Color(0xFFFAB219)
            }
            Text(libelle, color = teinte, fontSize = 11.sp)

            Text(
                hms(secondes),
                color = if (capture == EtatCapture.REPOS) Encre3 else Encre1,
                fontSize = 48.sp, fontWeight = FontWeight.Light, fontFamily = FontFamily.Monospace
            )

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically) {

                Box(
                    Modifier.size(88.dp).clip(CircleShape)
                        .background(FondRelief)
                        .border(1.dp, if (capture == EtatCapture.REPOS) Trait else Critique, CircleShape)
                        .clickable(onClick = onBasculer),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        Modifier
                            .size(if (capture == EtatCapture.REPOS) 30.dp else 26.dp)
                            .clip(if (capture == EtatCapture.REPOS) CircleShape else RoundedCornerShape(7.dp))
                            .background(Critique)
                    )
                }

                Button(
                    onClick = onPointCle,
                    enabled = capture != EtatCapture.REPOS,
                    shape = RoundedCornerShape(28.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Quartz.copy(alpha = 0.18f),
                        contentColor = QuartzClair,
                        disabledContainerColor = Color(0x0AFFFFFF),
                        disabledContentColor = Encre3
                    ),
                    modifier = Modifier.height(56.dp)
                ) { Text("★  Point clé", fontSize = 15.sp, fontWeight = FontWeight.Medium) }
            }

            if (capture != EtatCapture.REPOS) {
                TextButton(onClick = onPause) {
                    Text(if (capture == EtatCapture.PAUSE) "Reprendre" else "Pause", color = Encre2)
                }
            }
        }
    }
}

@Composable
private fun PanneauDiscretion(
    discretion: Boolean, masquer: Boolean,
    onDiscretion: (Boolean) -> Unit, onMasquer: (Boolean) -> Unit
) {
    Panneau("Mode discrétion") {
        Text(
            "L'enregistrement continue écran éteint : le service garde le micro et le processeur éveillés. " +
                "Verrouillez le téléphone et rangez-le.",
            color = Encre2, fontSize = 13.sp
        )
        Spacer(Modifier.height(10.dp))
        Bascule("Notification sobre", "Ni titre de visite, ni durée affichée.", discretion, onDiscretion)
        Bascule(
            "Masquer sur l'écran verrouillé",
            "Plus discret, mais le bouton n'est plus à portée : restent la tuile et le casque.",
            masquer, onMasquer
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Pour poser un point clé sans déverrouiller : bouton de la notification, tuile « Point clé » " +
                "des réglages rapides, ou bouton du casque. Une vibration courte confirme.",
            color = Encre3, fontSize = 12.sp
        )
    }
}

@Composable
private fun Bascule(titre: String, detail: String, valeur: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(titre, color = Encre1, fontSize = 14.sp)
            Text(detail, color = Encre3, fontSize = 12.sp)
        }
        Switch(
            checked = valeur, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Encre1,
                checkedTrackColor = Quartz,
                uncheckedTrackColor = FondRelief
            )
        )
    }
}

@Composable
private fun Panneau(titre: String, badge: String? = null, contenu: @Composable ColumnScope.() -> Unit) {
    CadrePanneau {
        Column {
            Row(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text(titre, color = Encre1, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f))
                badge?.let { Text(it, color = Encre3, fontSize = 12.sp) }
            }
            contenu()
        }
    }
}

@Composable
private fun CadrePanneau(contenu: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(FondPanneau.copy(alpha = 0.72f))
            .border(1.dp, Trait, RoundedCornerShape(20.dp))
            .padding(18.dp)
    ) { contenu() }
}

@Composable
private fun Champ(valeur: String, onChange: (String) -> Unit, label: String, exemple: String) {
    OutlinedTextField(
        value = valeur, onValueChange = onChange,
        label = { Text(label, color = Encre3) },
        placeholder = { Text(exemple, color = Color(0xFF4A4960)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        textStyle = androidx.compose.ui.text.TextStyle(color = Encre1),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = TraitQuartz,
            unfocusedBorderColor = Trait,
            cursorColor = Quartz
        )
    )
}

/* ------------------------------------------------------- visites locales */

data class VisiteLocale(
    val dossier: File, val titre: String, val duree: Double, val points: Int, val mo: String
)

private fun visitesLocales(contexte: android.content.Context): List<VisiteLocale> {
    val racine = File(contexte.getExternalFilesDir(null), "visites")
    if (!racine.isDirectory) return emptyList()
    return racine.listFiles().orEmpty()
        .filter { it.isDirectory && File(it, "visite.json").exists() }
        .sortedByDescending { it.name }
        .mapNotNull { dossier ->
            runCatching {
                val fiche = JSONObject(File(dossier, "visite.json").readText())
                val audio = File(dossier, "audio.m4a")
                VisiteLocale(
                    dossier = dossier,
                    titre = fiche.optString("titre", dossier.name),
                    duree = fiche.optDouble("duree", 0.0),
                    points = fiche.optJSONArray("markers")?.length() ?: 0,
                    mo = "%.1f".format(audio.length() / 1_000_000.0)
                )
            }.getOrNull()
        }
}
