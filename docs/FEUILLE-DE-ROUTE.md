# Feuille de route

Ce que NOIRA ne fait pas encore, classé par rapport valeur / effort. Les
comparaisons portent sur Plaud (Note, Note Pro, NotePin) et Boya OS, dont les
fonctions publiées ont servi de repère.

---

## À faire en premier

### 1. Modèles de compte rendu par métier
**Valeur : très haute · effort : faible**

C'est l'argument commercial numéro un de Plaud, qui en annonce plus de dix
mille. La mécanique est simple : le schéma de sortie et la consigne changent
selon le type de visite.

Une réception de travaux veut des réserves numérotées avec localisation. Un
audit énergétique veut des relevés et des préconisations chiffrées. Un SAV veut
un symptôme, un diagnostic, une pièce, un temps passé. Le même moteur, quatre
sorties différentes.

Implémentation : un dossier `modeles/` avec un schéma JSON et une consigne par
métier, un sélecteur au démarrage de l'enregistrement. Le reste ne bouge pas.

### 2. Photos horodatées pendant l'enregistrement
**Valeur : très haute · effort : moyen**

Aucun des deux concurrents ne le fait, et c'est exactement ce qui manque à une
visite technique. Un bouton « photo » à côté du bouton « point clé », le cliché
horodaté sur la même ligne de temps, et l'image jointe au compte rendu à
l'endroit où elle a été prise.

Claude peut décrire l'image et la relier à ce qui se disait à cet instant : « la
photo prise à 4 min 12 montre la corrosion évoquée juste avant ». C'est le genre
de lien qu'un humain met dix minutes à reconstituer le soir.

### 3. Suivi des actions d'une visite à la suivante
**Valeur : très haute · effort : moyen**

Personne ne le fait, et c'est le vrai travail. Une action ouverte le 14 mars
est-elle close le 18 avril ? Le RAG sait déjà répondre : il suffit de lui poser
la question automatiquement à chaque nouvelle visite sur le même site, et
d'afficher un état — close, toujours ouverte, non évoquée.

L'infrastructure existe intégralement. Il ne manque que le lien site → historique
et l'appel au bon moment.

### 4. Dictionnaire de vocabulaire métier
**Valeur : haute · effort : faible**

Plaud appelle ça « custom vocabulary ». Whisper écrit « ère quatre cent dix a »
là où il faudrait « R410A ». Un fichier de termes — références, marques, noms
d'intervenants, sigles du site — corrigé après transcription et injecté dans la
consigne de synthèse.

Deux cents termes suffisent à transformer la qualité perçue. C'est le meilleur
rapport effort / effet de toute cette liste.

---

## Ensuite

### 5. Qui parle (diarisation)
**Valeur : haute · effort : élevé**

Plaud en fait un argument majeur et annonce 95 % de justesse. La référence
ouverte est `pyannote` associé à `faster-whisper` (ou WhisperX), mais elle ne
tourne pas dans un navigateur : c'est du Python, et les modèles de pyannote sont
sous licence conditionnée.

Deux chemins honnêtes :

- **Local optionnel** : un script Python à côté du serveur, activé seulement si
  l'utilisateur l'installe. Le format `transcript.json` porte déjà le champ
  `speaker`, tout est prêt à le recevoir.
- **Approximation utile** : découper sur les silences et laisser l'utilisateur
  nommer les voix une fois, puis rapprocher les segments par proximité
  acoustique. Moins juste, mais dans le navigateur et gratuit.

À noter : sur une visite technique à deux ou trois personnes, savoir *qui* parle
compte moins que *ce qui* est dit. À placer après les quatre premiers points.

### 6. Carte mentale
**Valeur : moyenne · effort : moyen**

Signature visuelle de Plaud comme de Boya. La synthèse produit déjà une
arborescence implicite (phases → décisions → alternatives) ; il s'agit surtout
d'un rendu radial. Joli, démonstratif, moins utile au quotidien que la
chronologie — d'où son rang.

### 7. Résumé qui se construit pendant la visite
**Valeur : moyenne · effort : moyen**

Toutes les dix minutes, une passe sur ce qui vient d'être dit. À la sortie du
local technique, le compte rendu est déjà là.

Réserve : cela multiplie les appels à Claude sur la durée d'une visite. Aucun
coût en jetons, mais les limites d'usage de l'abonnement sont réelles. À câbler
avec un interrupteur, pas par défaut.

### 8. Détection automatique des points clés
**Valeur : moyenne · effort : faible**

Repérer « attention », « important », « surtout ne pas », « il faut absolument »,
« je note » et proposer un repère que l'utilisateur confirme. Complète le bouton
sans le remplacer : ce qu'on marque volontairement vaut toujours plus que ce
qu'une liste de mots devine.

### 9. Exports PDF et tableur
**Valeur : moyenne · effort : faible**

Le markdown convient à un développeur, pas à un maître d'ouvrage. Un PDF avec
les graphiques, et un tableur des actions avec responsable et échéance, se
génèrent à partir de `synthese.json` sans rien changer en amont.

### 10. Historique par site
**Valeur : moyenne · effort : faible**

Une page par site : toutes les visites, la courbe des risques dans le temps, les
actions qui traînent. Le champ `site` existe déjà et n'est aujourd'hui qu'un
libellé.

---

## Plus tard

| Sujet | Pourquoi |
|---|---|
| Hors ligne complet (service worker) | Un sous-sol n'a pas de réseau. Le modèle Whisper est déjà en cache ; il reste à mettre l'interface en cache. |
| Chiffrement du dossier `data/` | Une visite contient des noms, des prix, parfois des failles de sécurité d'un bâtiment. |
| Traduction | Boya annonce 140 langues, Plaud 112. Whisper sait déjà traduire (`task: translate`) ; c'est un paramètre, pas un chantier. |
| Import d'enregistrements existants | Reprendre l'historique déjà accumulé ailleurs. |
| Signature du compte rendu sur place | Faire valider les réserves avant de quitter le site. |
| Rappels d'échéance | Les actions ont des dates ; personne ne les relit. |
| Raccourci système Android / iOS | Démarrer sans déverrouiller. |

---

## Ce qui a été écarté

**Un compagnon matériel.** Plaud et Boya vendent un boîtier. L'intérêt réel est
le bouton et le micro — tous deux remplaçables pour quinze à trente euros, comme
détaillé dans [MATERIEL.md](MATERIEL.md). Fabriquer du matériel contredirait le
principe de départ.

**Le cloud.** Synchroniser entre appareils implique un serveur, donc un coût
récurrent, donc un abonnement. La contrainte posée était l'inverse. Un dossier
`data/` dans un répertoire déjà synchronisé (Syncthing, Nextcloud, un disque
réseau) résout le même besoin sans rien ajouter.

**Les quotas.** Boya offre 320 minutes par mois en gratuit, puis 17,99 € par
mois. NOIRA n'a pas de compteur parce qu'il n'a rien à compter : la transcription
tourne chez vous.
