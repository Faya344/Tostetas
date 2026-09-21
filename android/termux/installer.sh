#!/data/data/com.termux/files/usr/bin/bash
#
# Installe Plodo dans Termux, pour en faire le poste lui-même.
#
# C'est le seul moyen de rendre l'application Android réellement autonome :
# Claude Code (le pont vers votre abonnement) est un outil en ligne de
# commande écrit pour un système de type Linux — il n'existe pas de version
# native compilable dans un APK. Termux fournit exactement ça, dans un
# bac à sable, sans root.
#
# Ce script installe Node, le CLI Claude et Plodo lui-même. Il NE PEUT PAS
# authentifier votre abonnement à votre place — `claude login` ouvre une
# fenêtre de connexion qu'il faut valider une fois, à la main.
#
# Usage, dans Termux :
#   curl -sL https://raw.githubusercontent.com/Faya344/Tostetas/claude/plaud-clone-rag-design-hjmwb3/android/termux/installer.sh | bash
# ou, si le dépôt est déjà cloné ailleurs :
#   bash android/termux/installer.sh

set -e

DEPOT="https://github.com/Faya344/Tostetas.git"
BRANCHE="claude/plaud-clone-rag-design-hjmwb3"
DOSSIER="$HOME/plodo"

echo "── Paquets système ─────────────────────────────────────────"
pkg update -y
pkg install -y nodejs-lts git termux-api

echo
echo "── Claude Code ─────────────────────────────────────────────"
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code
else
  echo "déjà installé : $(claude --version 2>/dev/null || echo présent)"
fi

echo
echo "── Code de Plodo ───────────────────────────────────────────"
if [ -d "$DOSSIER/.git" ]; then
  git -C "$DOSSIER" fetch origin "$BRANCHE"
  git -C "$DOSSIER" checkout "$BRANCHE"
  git -C "$DOSSIER" reset --hard "origin/$BRANCHE"
else
  git clone --branch "$BRANCHE" "$DEPOT" "$DOSSIER"
fi

echo
echo "── Démarrage automatique (Termux:Boot) ─────────────────────"
# Facultatif : sans l'app Termux:Boot (F-Droid), cette étape ne fait rien de
# grave, elle prépare juste le fichier pour le jour où vous l'installerez.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/demarrer-plodo.sh" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$DOSSIER"
PLODO_HOST=127.0.0.1 exec node server/index.mjs
EOF
chmod +x "$HOME/.termux/boot/demarrer-plodo.sh"

echo
echo "══════════════════════════════════════════════════════════════"
echo " Installation terminée. Il reste deux étapes, à la main :"
echo
echo " 1. claude login"
echo "    (ouvre le navigateur du téléphone pour lier votre abonnement —"
echo "     un geste unique, comme sur un ordinateur)"
echo
echo " 2. cd ~/plodo && PLODO_HOST=127.0.0.1 node server/index.mjs"
echo
echo " Puis, dans Plodo : Réglages → Poste de travail → « Ce téléphone (Termux) »."
echo
echo " Si Termux:Boot est installé (F-Droid), le serveur redémarrera seul"
echo " à chaque redémarrage du téléphone."
echo "══════════════════════════════════════════════════════════════"
