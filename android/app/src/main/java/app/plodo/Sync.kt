package app.plodo

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Envoi d'une visite vers le poste de travail.
 *
 * Le téléphone capture, le poste synthétise. Ce n'est pas un compromis : Claude
 * Code tourne sur un ordinateur, avec votre abonnement, et c'est ce qui permet
 * de ne rien payer de plus. Le téléphone fait ce qu'il fait le mieux — être dans
 * votre poche, avec un micro et un bouton.
 *
 * Trois appels sur l'API déjà en place : créer la visite, pousser l'audio,
 * poser les points clés. Rien de spécifique à l'Android côté serveur.
 */
object Sync {

    class EchecSync(message: String) : Exception(message)

    /** @return l'identifiant attribué par le poste. */
    fun envoyer(poste: String, dossier: File): String {
        if (poste.isBlank()) throw EchecSync("Aucune adresse de poste renseignée.")

        val fiche = JSONObject(File(dossier, "visite.json").readText())
        val audio = File(dossier, "audio.m4a")
        if (!audio.exists()) throw EchecSync("Fichier audio introuvable.")

        val creation = JSONObject()
            .put("titre", fiche.optString("titre"))
            .put("site", fiche.optString("site"))
            .put("date", fiche.optString("date"))

        val reponse = json(poste + "/api/visites", "POST", creation.toString())
        val id = JSONObject(reponse).optString("id")
        if (id.isBlank()) throw EchecSync("Le poste n'a pas renvoyé d'identifiant.")

        televerser("$poste/api/visites/$id/audio", audio)

        val patch = JSONObject()
            .put("duree", fiche.optInt("duree"))
            .put("markers", fiche.optJSONArray("markers") ?: JSONArray())
        json("$poste/api/visites/$id", "PATCH", patch.toString())

        return id
    }

    private fun json(url: String, methode: String, corps: String): String {
        val co = ouvrir(url, methode)
        co.setRequestProperty("content-type", "application/json")
        co.doOutput = true
        co.outputStream.use { it.write(corps.toByteArray()) }
        return lire(co)
    }

    private fun televerser(url: String, fichier: File) {
        val co = ouvrir(url, "PUT")
        co.setRequestProperty("content-type", "audio/mp4")
        co.setFixedLengthStreamingMode(fichier.length())
        co.doOutput = true
        fichier.inputStream().use { entree -> co.outputStream.use { entree.copyTo(it) } }
        lire(co)
    }

    private fun ouvrir(url: String, methode: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = methode
            connectTimeout = 10_000
            // Un enregistrement d'une heure met un moment à passer sur du Wi-Fi
            // de chantier : mieux vaut attendre que rejouer le transfert.
            readTimeout = 10 * 60_000
        }

    private fun lire(co: HttpURLConnection): String {
        val code = co.responseCode
        val flux = if (code in 200..299) co.inputStream else co.errorStream
        val texte = flux?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) {
            val detail = runCatching { JSONObject(texte).optString("erreur") }.getOrNull()
            throw EchecSync(detail?.ifBlank { null } ?: "Le poste a répondu $code.")
        }
        return texte
    }
}
