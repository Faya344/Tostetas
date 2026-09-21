package app.plodo

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Tuile « Point clé » dans le volet des réglages rapides.
 *
 * C'est le geste le plus discret disponible sur Android : un balayage depuis le
 * haut, un appui, l'écran ne se déverrouille pas. La tuile reste grisée tant
 * qu'aucun enregistrement n'est en cours, pour qu'un appui distrait ne fasse rien.
 */
class TuilePointCle : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        majTuile()
    }

    override fun onClick() {
        super.onClick()
        if (Etat.capture.value == EtatCapture.REPOS) return
        ServiceEnregistrement.envoyer(this, ServiceEnregistrement.ACTION_MARQUER)
        majTuile()
    }

    private fun majTuile() {
        val tuile = qsTile ?: return
        val actif = Etat.capture.value != EtatCapture.REPOS
        tuile.state = if (actif) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tuile.label = getString(R.string.point_cle)
        tuile.subtitle = if (actif) "${Etat.points.value.size} posé(s)" else "Aucun enregistrement"
        tuile.updateTile()
    }
}
