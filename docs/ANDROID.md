# Plodo sur Android

L'APK est la réponse au mode discrétion. Un navigateur ne tient pas la promesse
« écran verrouillé, téléphone en poche » — Android suspend un onglet dont
l'écran est éteint, et la capture finit par caler. Ce n'est pas un défaut de
Plodo, c'est la règle du système.

Une application, elle, peut déclarer un **service au premier plan de type
microphone**. Android s'engage alors à ne pas la tuer, en échange d'une
notification visible. C'est exactement le contrat qu'il fallait.

---

## Ce que fait l'application

Elle enregistre, et rien d'autre. Pas de transcription, pas de synthèse : le
téléphone capture, le poste réfléchit.

Ce partage n'est pas un compromis, c'est la conséquence directe de la contrainte
de départ. Claude Code tourne sur un ordinateur, avec votre abonnement — c'est
ce qui permet de ne rien payer de plus. Le téléphone fait ce qu'il fait le
mieux : être dans votre poche, avec un micro et un bouton.

C'est d'ailleurs le modèle de Plaud, à ceci près que le boîtier à 170 € est
remplacé par le téléphone que vous avez déjà.

---

## Le mode discrétion

Verrouillez le téléphone et rangez-le. L'enregistrement continue : le service
garde un verrou processeur partiel, le micro reste ouvert, l'écran peut
s'éteindre.

### Poser un point clé sans déverrouiller

Trois chemins, tous utilisables écran éteint :

| Geste | Où |
|---|---|
| Un appui sur **Point clé** | bouton de la notification, présent sur l'écran de verrouillage |
| Un balayage vers le bas, un appui | tuile **Point clé** des réglages rapides |
| Un appui sur le fil du casque | « piste suivante » d'un casque filaire ou Bluetooth |

Une vibration courte confirme. Rien ne s'allume, rien ne sonne.

### Deux réglages

- **Notification sobre** (activée par défaut) — la notification n'affiche ni le
  titre de la visite ni la durée. Quelqu'un qui regarde par-dessus votre épaule
  ne lit qu'« Enregistrement ».
- **Masquer sur l'écran verrouillé** — plus discret encore, mais le bouton
  n'est plus à portée de pouce. Restent la tuile et le casque.

### Ajouter la tuile

Volet des réglages rapides → crayon (modifier) → faites glisser **Point clé**
parmi les tuiles actives. À faire une fois.

---

## Installer

L'APK est signé avec une clé de développement : il s'installe directement, sans
passer par un store.

1. Copiez `app-debug.apk` sur le téléphone.
2. Ouvrez-le. Android demandera d'autoriser l'installation depuis cette source —
   c'est normal pour un APK qui ne vient pas du Play Store.
3. Au premier lancement, accordez le micro et les notifications.

**Android 8.0 minimum** (API 26).

### Désactiver l'optimisation de batterie

Certains constructeurs (Xiaomi, Huawei, Oppo, Samsung) tuent les services en
arrière-plan plus agressivement que l'Android de référence. Si un enregistrement
long s'interrompt :

Réglages → Applications → Plodo → Batterie → **Sans restriction**.

C'est le seul réglage système qui compte vraiment pour la fiabilité.

---

## Appairer avec le poste

1. Sur l'ordinateur, lancez Plodo en écoutant le réseau local :

   ```bash
   PLODO_HOST=0.0.0.0 npm start
   ```

   Par défaut le serveur n'écoute que `127.0.0.1` : rien ne sort de la machine.
   Cette variable ouvre l'écoute au réseau local, et à lui seul.

2. Relevez l'adresse de l'ordinateur sur le réseau (`ip a` sous Linux,
   `ipconfig` sous Windows) — quelque chose comme `192.168.1.20`.

3. Dans l'application, **Poste de travail** → `http://192.168.1.20:7331`.

4. Après une visite, **Envoyer**. L'audio et les points clés partent sur le
   poste, qui prend le relais : transcription, synthèse, graphiques.

Le transfert passe en HTTP simple. Il ne quitte pas le réseau local, et n'expose
rien de plus que le câble lui-même.

### Sans réseau

Chaque visite est un dossier autonome dans
`Android/data/app.plodo/files/visites/<id>/`, avec `audio.m4a` et `visite.json`.
Copiez-le dans `data/visites/` du poste, lancez `npm run reindex`, et c'est la
même chose. Le câble USB reste une option.

---

## Compiler l'APK soi-même

Il faut un JDK 17 ou plus récent et le SDK Android (API 35).

```bash
cd android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
gradle assembleRelease
```

L'APK sort dans `app/build/outputs/apk/release/`.

Le fichier n'est pas versionné : un binaire de 16 Mo n'a rien à faire dans un
dépôt git, et il se régénère en une commande.

---

## Format audio

AAC mono 16 kHz, 32 kbit/s, dans un conteneur MP4 (`.m4a`) — environ 15 Mo pour
une heure.

16 kHz est exactement la fréquence qu'attend Whisper : enregistrer plus large ne
ferait que gonfler le fichier sans rien apporter à la transcription. Le serveur
accepte aussi le WebM du navigateur, l'OGG, le MP3 et le WAV, et range chaque
fichier sous sa vraie extension.

---

## Ce que l'application ne fait pas

- **Pas de transcription sur le téléphone.** Whisper sur mobile est possible
  mais lent et gourmand en batterie ; le poste le fait mieux, gratuitement, et
  vous laisse partir en visite suivante.
- **Pas de synthèse.** Elle passe par Claude Code, qui vit sur l'ordinateur.
- **Pas de synchronisation automatique.** L'envoi est un geste explicite :
  vous savez quand vos enregistrements quittent le téléphone.
