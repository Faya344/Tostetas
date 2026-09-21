# Matériel

Rien n'est obligatoire. Plodo marche avec un téléphone et rien d'autre. Ce
document dit ce qu'on gagne à ajouter quelque chose, et ce qu'on ne gagne pas.

## Le bouton « point clé »

C'est le seul accessoire qui change vraiment la façon de travailler. Poser un
repère sans sortir le téléphone, sans enlever ses gants, sans interrompre la
personne en face.

### Ce qui marche déjà, sans rien acheter

| Moyen | Point clé | Démarrer / arrêter | Écran éteint |
|---|---|---|---|
| Notification (APK) | bouton **Point clé** | bouton **Arrêter** | oui |
| Tuile des réglages rapides (APK) | un appui | — | oui |
| Bouton du casque filaire | piste suivante | lecture/pause | oui |
| Écouteurs Bluetooth | double appui (selon le modèle) | appui simple | oui |
| Clavier (navigateur) | `K`, `Entrée`, `→`, `↓` | `Espace`, `←`, `↑` | — |

Les deux premiers chemins n'existent que dans l'application Android, et ce sont
les meilleurs : rien à appairer, rien à charger, rien à perdre. Voir
[ANDROID.md](ANDROID.md).

Le chemin « casque » passe par MediaSession : le système route les touches média
vers l'application tant qu'un média est déclaré actif, ce que Plodo fait pendant
l'enregistrement — y compris écran éteint.

L'accessoire n'est donc plus indispensable. Ce qui suit reste utile si vous
préférez un vrai bouton sous le doigt, ou si vous travaillez depuis le
navigateur.

### Ce qui vaut quinze euros

Une **télécommande Bluetooth « page turner »** (tourne-pages pour partitions,
déclencheur de selfie, présentateur). Elle se présente au système comme un
clavier et envoie des flèches ou Page suivante. Aucun pilote, aucun appairage
dans l'application : elle fonctionne dès qu'elle est connectée au téléphone.

Cherchez « page turner bluetooth », « télécommande présentation », « déclencheur
photo bluetooth ». Les critères qui comptent :

- **deux boutons au moins** — un pour marquer, un pour démarrer et arrêter ;
- **un vrai clic mécanique**, sentable avec des gants ;
- **un point d'attache** — mousqueton, clip de poche, bracelet ;
- **une pile bouton** plutôt qu'une batterie à recharger : elle tient un an et
  ne vous lâchera pas un mardi matin.

### Ce qui vaut davantage

| Matériel | Intérêt | Réserve |
|---|---|---|
| Flic 2 (~35 €) | trois gestes distincts (appui, double appui, appui long), aimanté | l'application Flic doit être en mode HID |
| Pédale USB (~25 €) | les mains restent libres | filaire, donc poste fixe |
| Manette Bluetooth | reconnue par l'API Gamepad, boutons nombreux | encombrante en poche |

Un boîtier HID non reconnu peut être appairé explicitement depuis
**Réglages → Appairer un boîtier HID**. Plodo traite alors tout rapport entrant
non nul comme un appui : on ne connaît pas le protocole du boîtier, mais
« quelque chose a changé » suffit pour un clicker.

## Le micro

Le micro du téléphone suffit dans un bureau. Il ne suffit pas dans un local
technique : réverbération, ventilation, machines.

| Situation | Ce qui change la donne |
|---|---|
| Local bruyant | micro-cravate filaire (~20 €) — l'écart avec le micro intégré est spectaculaire |
| Plusieurs interlocuteurs qui se déplacent | micro-cravate sans fil, un émetteur par personne |
| Extérieur venteux | une bonnette. Vingt euros contre une transcription illisible |

Un micro-cravate améliore la transcription bien plus qu'un modèle Whisper plus
gros : Whisper reconstruit mal ce qu'il n'a pas entendu.

## Le téléphone

Avec l'APK, le téléphone ne fait que capturer : la transcription et la synthèse
attendent le poste. C'est ce qui rend la batterie tranquille — c'est le calcul
qui chauffe un téléphone, pas un micro ouvert.

Depuis le navigateur, en revanche, Whisper tourne sur place. Sur un téléphone
récent avec WebGPU, le modèle « Rapide » traite une heure d'enregistrement en
quelques minutes ; sur une machine plus ancienne, le repli WASM fonctionne mais
demande de la patience. Le moteur « Dictée du navigateur » reste l'option
instantanée, moins précise et sans calcul.

## Autonomie

Un enregistrement d'une heure pèse environ 15 Mo depuis l'APK (AAC 16 kHz) ou
30 Mo depuis le navigateur (Opus 64 kbit/s), et consomme peu dans les deux cas.

Un point compte plus que le reste : **désactivez l'optimisation de batterie**
pour Plodo (Réglages → Applications → Plodo → Batterie → Sans restriction).
Certains constructeurs tuent les services en arrière-plan bien plus vite que
l'Android de référence, et c'est la seule cause sérieuse d'enregistrement
interrompu.
