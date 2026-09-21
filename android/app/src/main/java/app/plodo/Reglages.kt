package app.plodo

import android.content.Context

/**
 * Réglages persistés. Trois seulement, parce que trois suffisent.
 */
class Reglages(context: Context) {
    private val prefs = context.getSharedPreferences("plodo", Context.MODE_PRIVATE)

    /** Adresse du poste qui fait tourner Plodo, par exemple http://192.168.1.20:7331 */
    var poste: String
        get() = prefs.getString("poste", "") ?: ""
        set(v) = prefs.edit().putString("poste", v.trim().trimEnd('/')).apply()

    /**
     * Mode discrétion : notification sobre, aucun bandeau, rien qui clignote.
     * Le retour du point clé passe alors uniquement par une vibration courte.
     */
    var discretion: Boolean
        get() = prefs.getBoolean("discretion", true)
        set(v) = prefs.edit().putBoolean("discretion", v).apply()

    /**
     * Masquer la notification sur l'écran verrouillé. Plus discret encore, mais
     * on perd le bouton « point clé » à portée de pouce : il reste la tuile des
     * réglages rapides et le bouton du casque.
     */
    var masquerSurVerrouillage: Boolean
        get() = prefs.getBoolean("masquer", false)
        set(v) = prefs.edit().putBoolean("masquer", v).apply()
}
