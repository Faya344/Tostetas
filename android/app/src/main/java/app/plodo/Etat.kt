package app.plodo

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Un repère posé sur le terrain : la seconde exacte, et un libellé. */
data class PointCle(val t: Double, val libelle: String)

enum class EtatCapture { REPOS, ENREGISTRE, PAUSE }

/**
 * État partagé entre le service et l'écran.
 *
 * Le service est la source de vérité : il continue de tourner quand l'activité
 * est détruite (écran verrouillé, application balayée). L'écran ne fait que
 * lire ce qu'il publie.
 */
object Etat {
    private val _capture = MutableStateFlow(EtatCapture.REPOS)
    val capture: StateFlow<EtatCapture> = _capture.asStateFlow()

    private val _secondes = MutableStateFlow(0.0)
    val secondes: StateFlow<Double> = _secondes.asStateFlow()

    private val _points = MutableStateFlow<List<PointCle>>(emptyList())
    val points: StateFlow<List<PointCle>> = _points.asStateFlow()

    private val _titre = MutableStateFlow("")
    val titre: StateFlow<String> = _titre.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    fun publierCapture(e: EtatCapture) { _capture.value = e }
    fun publierSecondes(s: Double) { _secondes.value = s }
    fun publierPoints(p: List<PointCle>) { _points.value = p }
    fun publierTitre(t: String) { _titre.value = t }
    fun dire(m: String?) { _message.value = m }
}

/** Horodatage lisible, sans heure tant qu'il n'y en a pas besoin. */
fun hms(secondes: Double): String {
    val s = secondes.toInt().coerceAtLeast(0)
    val h = s / 3600
    val reste = "%02d:%02d".format((s % 3600) / 60, s % 60)
    return if (h > 0) "%02d:%s".format(h, reste) else reste
}
