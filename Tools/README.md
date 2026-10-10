# Creation de l'archive de release

Sous Windows, double-cliquer sur **`Tools/creer-archive.cmd`**.

Le lanceur appelle `Tools/package.ps1` avec PowerShell et place
`automated-weapon-mastery.zip` **à la racine du projet**.

Le ZIP installable contient `module.json` à sa racine, les scripts et styles,
ainsi que les ressources de distribution présentes. Il n'inclut pas `.git`,
`Tools`, `tests` ni les fichiers de développement.

## Publication GitHub

1. Mettre à jour la version et les URL `manifest` et `download` dans `module.json`.
2. Exécuter `Tools/creer-archive.cmd`.
3. Créer la release GitHub avec le tag `v<version>` (ex. `v12.0.0`).
4. Joindre **les deux fichiers** : `automated-weapon-mastery.zip` et `module.json`.

Le nom du ZIP reste identique à chaque release : c'est le **tag** qui change.
Cela correspond à l'URL `download` déclarée dans le manifeste.

## Lancement manuel

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\package.ps1
```

Avec Node.js installé, `package.ps1` lance automatiquement les vérifications
statiques (`node Tools/check.mjs`). Sans Node.js, le contrôle du manifeste et
la vérification du contenu de l'archive fonctionnent quand même.

Le script ne modifie ni les sources, ni le numéro de version, ni les URL.
Il remplace uniquement le ZIP de release si sa création est réussie.
