# Community Coin

> *« the first person to figure out the vamp/pvp problem with memes will be a billionaire »* (@alpha_co)

Community Coin est un launchpad de memecoins (contrats Solidity, testés) conçu contre les deux maladies
des memes : le **vamp** (chaque meme qui marche est copié, et chaque copie vide l'original) et le **PvP**
(les premiers arrivés, souvent des bots, revendent sur la vague des suivants).

Ce dépôt contient le protocole, 26 tests, un simulateur qui joue **le même scénario viral sur les vrais
contrats** (une fois avec les règles d'aujourd'hui, une fois avec celles-ci, pour mesurer qui paie qui), et
**l'application du launchpad**.

**Résultat en une phrase :** le vamp se règle dans le protocole ; le PvP se réduit fortement, mais ne
disparaît pas, et aucun mécanisme ne peut le faire disparaître, parce qu'un marché de memes est à somme
nulle. Le détail, chiffres compris, est plus bas, y compris ce qui n'a pas marché.

## L'application

Le launchpad complet tourne dans le navigateur : explorer les familles, lancer un meme ou une variante,
participer à une enchère d'ouverture, retirer son allocation au fil du vesting, acheter et vendre (en ETH à
travers toute la lignée, ou directement dans le token parent), proposer et voter une Union, retirer ses frais
de créateur.

- **Mode démo**, celui de la version en ligne : les vrais contrats compilés s'exécutent dans une EVM à
  l'intérieur de la page, avec des comptes de démo crédités d'ETH fictif et une horloge que l'on peut avancer
  (5 min, 1 h, 1 jour, 3 jours) pour vivre l'ouverture, le vesting et les votes. La page s'ouvre sur un marché
  d'exemple : une famille `PNUT` avec ses variantes, un rival `PEANUT` en plein vote d'Union, une ouverture en
  cours.
- **Mode wallet** : la même application se connecte à un hub déployé sur une vraie chaîne via un wallet du
  navigateur, dès qu'un déploiement est inscrit dans `web/src/deployments.js`. Ce mode demande un hébergement
  classique (GitHub Pages, ci-dessous), car la page hébergée sur claude.ai ne peut joindre ni wallet ni nœud.

**L'interface** suit le skill [dashboard-design](https://github.com/abdiraimov-otabek/dashboard-design-skill)
(MIT, installé dans `.claude/skills/dashboard-design/`). Chaque écran répond à une question au premier coup
d'œil. Les explications sont dans les infobulles, pas à l'écran. La couleur est réservée à ce qui demande une
action, et chaque chiffre clé est comparé à il y a une heure. Chaque point d'attention (ouverture en cours,
Union prête, tokens à retirer, prix en pic) est signalé là où il apparaît, avec son action à côté.

Le code est dans `web/` (Preact, ethers, EVM d'ethereumjs, regroupés par esbuild en un seul script). Pour la
construire, puis la tester de bout en bout dans Chromium sous une politique de sécurité stricte (`test:web`
recalcule aussi l'historique de démo à part pour vérifier les totaux affichés, et vérifie qu'aucune phrase
ne traîne à l'écran) :

```bash
npm run build:web
```

```bash
npm run test:web
```

Ensuite `web/dist/index.html` s'ouvre directement dans un navigateur.

**L'héberger soi-même.** Le workflow `.github/workflows/pages.yml` publie l'application sur GitHub Pages à
chaque push sur `main`. Il faut l'activer une fois : *Settings → Pages → Build and deployment → Source :
GitHub Actions*.

**La brancher sur une vraie chaîne.** Commencer par un testnet (Base Sepolia par exemple), avec une clé
dédiée et un peu d'ETH de test :

```bash
RPC_URL=https://sepolia.base.org DEPLOYER_KEY=0x... npm run deploy
```

Le script affiche la ligne à ajouter dans `web/src/deployments.js` ; reconstruire et republier l'application
fait apparaître le bouton « Connect wallet ». Pas de mainnet avant un audit.

## Le diagnostic

| Symptôme | Cause réelle |
|---|---|
| 50 tokens « PNUT » en 10 minutes | Créer un token ne coûte rien et rien ne relie un meme à *un* token |
| Les copies vident l'original | Chaque copie est un pool ETH concurrent : chaque ETH qui va à la copie n'ira jamais à l'original |
| Les bots snipent le premier bloc | Le premier acheteur obtient un prix que personne d'autre ne peut avoir |
| Les bots revendent sur la vague | Le moins cher des tokens est liquide immédiatement, pendant que la demande monte |
| Personne ne « gagne » au total | Une courbe de bonding est à somme nulle : tout ETH sorti a été mis par quelqu'un d'autre |

## Le mécanisme, en cinq pièces

1. **Un meme, un ticker.** Le ticker est normalisé (casse, ponctuation, emojis, leetspeak : `PNUT`,
   `$pnut`, `P.N.U.T`, `PNU7` sont le même meme). Un doublon ne peut pas être lancé : le contrat répond
   avec l'adresse de l'existant.
2. **Lignée (anti-vamp).** Une variante se lance *dans la famille* du meme qu'elle copie : sa courbe est
   cotée en token parent, pas en ETH. Acheter la copie, c'est d'abord acheter l'original (le routeur le
   fait en une transaction), et l'argent qui sort d'une copie perdante retombe dans l'original au lieu de
   quitter le meme. Il n'y a qu'un seul pool ETH par famille. Le créateur de l'original touche 1 % sur tout
   le volume qui traverse son meme.
3. **Ouverture équitable.** Les 5 premières minutes de chaque lancement sont une enchère groupée : tous
   les participants paient le même prix, créateur compris. Snipe et bundle du premier bloc n'achètent rien.
   Ces places, les moins chères, **vestent sur une heure** : impossible de les revendre sur la première vague.
4. **Part de pic.** Quand une vente s'exécute au-dessus du prix de référence (une moyenne mobile d'une
   heure), la moitié de l'excédent reste dans la réserve et fait monter le prix de tous les tokens restants :
   ceux qui vendent dans la vague paient ceux qui ont acheté la vague. Vendre patiemment, ou dans un marché
   qui baisse, ne coûte rien de plus que le 1 % de frais. Seule la partie de la vente exécutée au-dessus de
   la référence est comptée (intégrale fermée sur la courbe), donc un gros dump n'y échappe pas en écrasant
   son propre prix moyen.
5. **Union.** Deux memes rivaux (`PNUT` et `PEANUT`) peuvent fusionner au lieu de se battre. Les détenteurs
   de `PEANUT` votent en verrouillant leurs tokens (majorité de l'offre en circulation, vote de 3 jours) ;
   pendant le vote, les opposants peuvent sortir sur la courbe. Si le vote passe, toute la réserve ETH de
   `PEANUT` achète du `PNUT` et la courbe de `PEANUT` est re-cotée en `PNUT` au taux obtenu : `PEANUT` garde
   son nom, ses détenteurs et leurs soldes, ses propres variantes suivent, et la famille n'a plus qu'un pool.

Socle commun : chaque token vit sur une courbe *constant product* à réserves virtuelles détenue par le
contrat, sans owner, sans upgrade, sans clé admin. Le contrat peut toujours racheter la totalité de l'offre
en circulation de chaque token ; c'est l'invariant principal des tests.

## Ce que montre la simulation

`npm run simulate` joue 10 fois le même scénario sur les contrats : un original (`PNUT`, 24 acheteurs)
puis 5 copies (10 acheteurs chacune), environ 59 ETH d'argent « retail » au total. À chaque lancement : le
créateur et un bot sniper entrent en premier (dans l'enchère groupée côté Community Coin, avec la première
moitié des acheteurs), puis le reste de la vague. Ensuite la retombée : le bot vend tout ce qu'il peut, la
moitié des acheteurs de la vague (les « paper hands ») vend derrière lui. Quand la hype s'arrête, tout le
monde vend ce qu'il reste dans un ordre aléatoire. Tout finit en ETH, donc la somme est exactement nulle :
la seule question est qui paie qui.

Résultat moyen en ETH, le bot sortant à un moment aléatoire de la fin (personne ne sait où est le sommet) :

| | Aujourd'hui | Community Coin |
|---|---:|---:|
| Bot sniper | +53,00 | +46,95 |
| Créateur de l'original | +0,43 | +1,16 |
| Créateurs des copies | +1,20 | −1,44 |
| Acheteurs de l'original | −17,25 | **−7,64** |
| Acheteurs des copies | −37,38 | −39,02 |
| **Tout le retail** | −54,63 | **−46,67** |
| Somme (contrôle de somme nulle) | 0,00 | 0,00 |
| Pic d'ETH derrière `PNUT` | 19,95 | 23,05 |
| Pools ETH pour le même meme | 6 | 1 |

Si le bot connaît le sommet et sort le premier, les chiffres bougent à peine (bot +47,20, retail −46,95).
Lancer une copie ne rapporte plus rien à celui qui la lance (+1,20 → −1,44) : le vamp cesse de payer.

Les mêmes règles **sans lignée** (copies lancées comme racines indépendantes, `LINEAGE=0`, 10 scénarios) :
bot +28,00, acheteurs de l'original −9,46, acheteurs des copies −18,75, **tout le retail −28,21**, soit
presque deux fois moins de pertes qu'aujourd'hui.

L'ablation (5 scénarios, mêmes hypothèses) dit d'où vient chaque effet :

| Configuration | Bot | Acheteurs de l'original | Acheteurs des copies | Tout le retail |
|---|---:|---:|---:|---:|
| Aujourd'hui (courbes simples, pas de lignée) | +52,7 | −17,4 | −37,0 | −54,4 |
| Enchère d'ouverture seule | +46,1 | −14,4 | −31,2 | −45,7 |
| Enchère + part de pic | +42,5 | −13,2 | −29,0 | −42,2 |
| Enchère + vesting | +28,7 | −8,6 | −20,3 | −29,0 |
| Enchère + vesting + part de pic | +28,0 | −9,4 | −18,9 | −28,3 |
| Enchère + lignée | +54,0 | −14,4 | −39,2 | −53,6 |
| Tout (Community Coin) | +46,9 | −8,0 | −38,6 | −46,6 |

Ce qu'il faut en retenir, sans enjoliver :

- **Le vesting de l'ouverture est le vrai levier anti-PvP.** Il divise presque par deux le gain du bot et les
  pertes du retail. La part de pic ajoute un peu (elle vise surtout les acheteurs post-ouverture, qui ne sont
  pas vestés).
- **La lignée règle le vamp, pas le PvP.** Elle fait ce qu'elle promet : chaque copie nourrit l'original,
  les acheteurs de l'original perdent plus de deux fois moins qu'aujourd'hui, lancer une copie ne paie plus,
  et le meme n'a qu'un pool. Mais elle transfère aussi la demande des copies vers *tous* les
  détenteurs précoces de l'original, bots compris : un bot qui détient `PNUT` revend dans chaque vague de
  copie. Avec la lignée, les acheteurs de copies paient un péage à la famille et ne s'en sortent pas mieux
  qu'aujourd'hui.
- **Le bot reste gagnant dans tous les cas.** C'est la nature d'un marché à somme nulle : celui qui entre tôt
  et sort avant les autres gagne l'argent de ceux qui sortent après. Le protocole retire les avantages
  *privilégiés* (premier bloc, revente immédiate des places les moins chères, fragmentation) ; il ne peut pas
  retirer l'avantage d'être rapide et de vendre le premier. Toute personne qui promet le contraire vend
  quelque chose.

En clair : pour protéger le retail du PvP, ce sont l'ouverture groupée et le vesting qui comptent, et ils
devraient être la règle pour tous les lancements. La lignée est un choix de la communauté d'un meme qui veut
se protéger des copies : elle protège ses détenteurs, pas les acheteurs de copies. C'est pour ça qu'elle
reste optionnelle (le lanceur d'une variante choisit son parent, ou aucun).

## Ce que ça ne résout pas

- **Les vamps hors protocole.** Rien n'empêche de copier un meme sur un autre launchpad ou une autre chaîne.
  Le protocole ne peut que rendre l'intérieur plus attractif : une variante lancée dans la famille hérite
  d'une communauté qui a intérêt à la pousser.
- **La somme nulle.** Voir plus haut. L'argent qui sort a été mis par quelqu'un d'autre.
- **Le dédoublonnage par ticker seul.** `PNUT` et `PEANUT` restent deux tickers ; c'est le rôle de l'Union.
  Un dédoublonnage par image ou par nom demanderait un oracle hors chaîne.
- **Le MEV sur l'exécution d'une Union.** Le gros achat de l'Union peut être sandwiché ; l'exécutant fixe un
  `minTargetIn`, et sur un L2 à séquenceur privé le risque est moindre, mais il existe.
- **L'audit.** Ce code n'est pas audité. Ne le déployez pas avec de l'argent réel en l'état.

## Utiliser

Node 22. Le compilateur `solc` est pris dans `node_modules` (aucun téléchargement de binaire).

```bash
npm install
```

```bash
npm test
```

```bash
npm run simulate
```

(`npm run build:web` et `npm run test:web` pour l'application, voir plus haut.)

Le simulateur accepte `SEEDS` (nombre de scénarios), et pour l'ablation `VEST`, `SPIKE` et `LINEAGE` :

```bash
VEST=0 SPIKE=0 LINEAGE=1 SEEDS=5 npm run simulate
```

## Le contrat

`contracts/CommunityCoin.sol` (le hub, ~19 Ko de bytecode) et `contracts/MemeToken.sol` (un ERC20 dont seul
le hub peut frapper, brûler ou déplacer les tokens, et uniquement ceux de `msg.sender`).

| Fonction | Rôle |
|---|---|
| `launch(name, symbol, parent)` | Lance un meme ; `parent = 0` pour une racine cotée en ETH. L'ETH envoyé est engagé dans l'ouverture. |
| `commit` / `commitEth` | Participer à l'enchère d'ouverture (en actif de cotation, ou en ETH routé par les ancêtres). |
| `settle` / `claim` | Clôturer l'ouverture (n'importe qui) ; retirer la part vestée de son allocation. |
| `buy` / `buyEth` | Acheter avec l'actif de cotation, ou avec de l'ETH routé à travers toute la lignée. |
| `sell` / `sellToEth` | Vendre contre l'actif de cotation (le parent, donc l'argent reste dans la famille) ou jusqu'à l'ETH. |
| `claimFees(asset)` | Le créateur retire ses frais (1 %), payés dans l'actif de cotation de son meme. |
| `proposeUnion` / `lockUnion` / `unlockUnion` / `executeUnion` | Le cycle de vote d'une Union. |
| `quoteBuyEth` / `quoteSellToEth` / `quoteBuy` / `quoteSell` | Ce que rapporte un achat ou une vente, frais et part de pic compris. |
| `priceInEth` / `referencePrice` / `lineageOf` / `circulatingSupply` | Vues pour les interfaces. |

Paramètres (constructeur) : durée de l'ouverture, durée du vesting, part de pic (en points de base),
durée d'un vote d'Union. Constantes : courbe de 1 milliard de tokens virtuels, 1 ETH virtuel pour une racine,
1 million de tokens parents virtuels pour une variante (les variantes d'un gros meme démarrent plus cher),
1 % de frais, profondeur de lignée maximale de 6.

## La suite

- Une sortie de courbe vers un AMM (hook Uniswap v4), avec la part de pic en frais dynamiques.
- Étendre le vesting aux achats de la première heure, pas seulement à l'ouverture : c'est ce que suggère
  l'ablation.
- Fuzzing et vérification formelle de l'invariant de solvabilité ; audit.
- Un portage Solana, là où vit la majorité des memes.

*Ceci est un prototype de recherche, pas un conseil financier. Les memecoins sont des actifs spéculatifs à
somme nulle ; la plupart des participants y perdent de l'argent.*
