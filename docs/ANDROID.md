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

---

## Autonomie complète, un seul appareil (expérimental)

**Question légitime : pourquoi pas tout sur le téléphone ?** Parce que Claude
Code — le pont vers votre abonnement, celui qui évite tout jeton facturé — est
un outil en ligne de commande écrit pour un système de type Linux. Il n'existe
pas de version qui se compile à l'intérieur d'un APK. Ce n'est pas un manque
d'effort, c'est que l'APK et le CLI ne sont pas la même catégorie de logiciel.

Il y a malgré tout un moyen d'avoir les deux sur le même appareil :
**[Termux](https://f-droid.org/packages/com.termux/)**, un émulateur de
terminal Linux pour Android, sans root, disponible sur F-Droid (plus sur le
Play Store depuis 2020 — c'est la version F-Droid qu'il faut). Termux fournit
un vrai Node.js. Si `claude` s'y installe et s'y authentifie normalement, alors
Plodo peut y tourner exactement comme sur un ordinateur — parce que c'est le
même code, au même serveur près, qui change simplement d'adresse.

### Ce qui est vérifié, et ce qui ne l'est pas

Vérifié ici même : le serveur Plodo (`server/index.mjs`) n'a aucune dépendance
et tourne sur n'importe quel Node 20+, quel que soit l'hôte.

**Non vérifié, faute d'un appareil Android sous la main : que `claude login`
se déroule normalement dans le bac à sable de Termux.** C'est la seule vraie
inconnue de ce chemin — tout le reste n'est que la réutilisation de pièces déjà
testées. Le script ci-dessous prépare tout jusqu'à cette étape ; à vous de la
franchir une fois et de constater si ça passe.

### Installer

Dans Termux :

```bash
curl -sL https://raw.githubusercontent.com/Faya344/Tostetas/claude/plaud-clone-rag-design-hjmwb3/android/termux/installer.sh | bash
```

Puis, à la main :

```bash
claude login                                    # une fois, lie l'abonnement
cd ~/plodo && PLODO_HOST=127.0.0.1 node server/index.mjs
```

Dans Plodo : **Réglages → Poste de travail → « Ce téléphone (Termux) »**. Le
reste ne change pas — envoyer une visite, la voir apparaître, la transcrire,
la synthétiser, tout se passe maintenant sans jamais quitter l'appareil.

### Ce qui tiendra, ce qui demande un essai

| Point | État |
|---|---|
| Le serveur Plodo dans Termux | Le même code que sur un poste — aucune raison de se comporter autrement. |
| `claude login` dans le bac à sable Termux | **À tester sur votre appareil.** Dites-moi ce que ça donne. |
| Le service Android + le serveur Termux, en même temps | Deux processus indépendants ; le premier enregistre, le second réfléchit une fois la visite envoyée. Pas de conflit attendu, la synchronisation passe par le réseau comme avec un poste distant. |
| Redémarrage automatique | Nécessite l'app **Termux:Boot** (F-Droid, à installer en plus) ; sinon il faut relancer le serveur à la main après chaque redémarrage du téléphone. |
| Tenue en arrière-plan de Termux lui-même | Exclure aussi *Termux* de l'optimisation de batterie, en plus de Plodo — deux applications, deux réglages. |

### Le repli, si ça ne passe pas

Si `claude login` échoue dans Termux (limite plausible : certaines briques
natives d'un paquet npm supposent un système standard, pas le bac à sable
Termux), rien n'est perdu : gardez l'adresse d'un poste classique dans
Réglages, et le reste de l'application fonctionne à l'identique. Dites-le-moi
si vous testez — je pourrai adapter le script selon ce qui bloque réellement.

### Ce qui ne changera pas de nature

Même en Termux, la transcription Whisper tourne toujours dans un *navigateur*
(`server/index.mjs` sert des pages web, il ne transcrit rien lui-même). Ouvrez
donc `http://127.0.0.1:7331` dans le navigateur du téléphone pour lancer une
transcription — l'application Android, elle, ne fait qu'enregistrer et
envoyer. C'est un aller-retour de plus, mais toujours sur le même appareil,
sans réseau externe.

## Ce que l'application ne fait pas

- **Pas de transcription sur le téléphone.** Whisper sur mobile est possible
  mais lent et gourmand en batterie ; le poste le fait mieux, gratuitement, et
  vous laisse partir en visite suivante.
- **Pas de synthèse.** Elle passe par Claude Code, qui vit sur l'ordinateur.
- **Pas de synchronisation automatique.** L'envoi est un geste explicite :
  vous savez quand vos enregistrements quittent le téléphone.
