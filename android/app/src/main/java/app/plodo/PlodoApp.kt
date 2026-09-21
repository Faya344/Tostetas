package app.plodo

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class PlodoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // IMPORTANCE_LOW : la notification existe (Android l'exige pour un service
        // au premier plan) mais ne sonne pas, ne vibre pas et ne s'impose pas.
        val canal = NotificationChannel(
            CANAL,
            getString(R.string.canal_enregistrement),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Enregistrement en cours"
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
    }

    companion object {
        const val CANAL = "plodo.enregistrement"
    }
}
