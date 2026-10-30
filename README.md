# Community Coin

> *« the first person to figure out the vamp/pvp problem with memes will be a billionaire »* (@alpha_co)

Community Coin est un launchpad de memecoins sur **Solana** (un programme Anchor, testé) conçu contre les deux
maladies des memes : le **vamp** (chaque meme qui marche est copié, et chaque copie vide l'original) et le
**PvP** (les premiers arrivés, souvent des bots, revendent sur la vague des suivants).

Ce dépôt contient le programme et ses tests, une réplique exacte de ses règles en JavaScript vérifiée contre
lui étape par étape, un simulateur qui joue **le même scénario viral** une fois avec les règles d'aujourd'hui et
une fois avec celles-ci pour mesurer qui paie qui, et **l'application du launchpad**. La première version, en
Solidity pour Base, reste dans le dépôt comme référence (dernière section).

**Résultat en une phrase :** le vamp se règle dans le protocole ; le PvP se réduit fortement, mais ne
disparaît pas, et aucun mécanisme ne peut le faire disparaître, parce qu'un marché de memes est à somme
nulle. Le détail, chiffres compris, est plus bas, y compris ce qui n'a pas marché.

## L'application

Le launchpad complet tourne dans le navigateur : explorer les familles, lancer un meme ou une variante,
participer à une enchère d'ouverture, retirer son allocation au fil du vesting, acheter et vendre (en SOL à
travers toute la lignée, ou directement dans le token parent), proposer et voter une Union, retirer ses frais
de créateur.

- **Mode démo**, celui de la version en ligne : les règles exactes du programme s'exécutent dans la page
  (`web/src/protocol.js`), avec des comptes de démo crédités de SOL fictif et une horloge que l'on peut avancer
  (5 min, 1 h, 1 jour, 3 jours) pour vivre l'ouverture, le vesting et les votes. La page s'ouvre sur un marché
  d'exemple (`web/src/seed.json`) : une famille `PNUT` avec ses variantes, un rival `PEANUT` en plein vote
  d'Union, une ouverture en cours.
- **Mode wallet** : la même application se connecte au programme déployé avec **Phantom**, dès qu'un
  déploiement est inscrit dans `web/src/deployments.js` (le script d'initialisation s'en charge, voir
  « Déployer sur Solana »). Elle lit les comptes du programme, fait d'abord tourner chaque transaction sur ses
  règles (un refus est expliqué avant même d'ouvrir le wallet), puis l'envoie et lit ses événements. Ce mode
  demande un hébergement classique (GitHub Pages, ci-dessous) : la page hébergée sur claude.ai ne peut joindre
  ni wallet ni nœud.

**L'interface** suit le skill [dashboard-design](https://github.com/abdiraimov-otabek/dashboard-design-skill)
(MIT, installé dans `.claude/skills/dashboard-design/`). Chaque écran répond à une question au premier coup
d'œil. La couleur est réservée à ce qui demande une action, et chaque chiffre clé est comparé à il y a une heure.
Chaque point d'attention (ouverture en cours, Union prête, tokens à retirer, prix en pic) est signalé là où il
apparaît, avec son action à côté.

Pour qu'un nouveau venu comprenne sans rien lire ailleurs :

- un **bandeau d'accueil** (thèse et quatre règles animées) et une page **How it works** construite sur les
  données vivantes de la démo, avec un calculateur « suivez votre SOL » et les résultats du simulateur ;
- une **visite guidée** de deux minutes qui attend de vraies transactions : s'engager dans une ouverture,
  avancer l'horloge, retirer, acheter une copie, revendre dans le pic, regarder un vote d'Union ;
- un **glossaire** unique (`web/src/glossary.js`) derrière chaque bouton « i », au clic, au toucher ou au clavier ;
- avant chaque échange, la **décomposition exacte** de ce que fait la transaction (impact sur le prix, frais par
  étape et bénéficiaire, part de pic retenue, réserve qui reçoit le SOL), puis un **reçu** tiré des événements de
  la transaction. La décomposition est la transaction elle-même, jouée à blanc sur les règles du programme
  (`web/src/preview.js`) : elle est juste au lamport près ;
- pour une Union, l'**avant/après** calculé de la même façon ; pour une ouverture, l'estimation de sa part et le
  calendrier du vesting ; pour une famille, son arbre.

Le code est dans `web/` (Preact et `@solana/web3.js`, regroupés par esbuild en un seul script de ~460 Ko).

```bash
npm run build:web
```

Ensuite `web/dist/index.html` s'ouvre directement dans un navigateur. Deux tests de bout en bout dans Chromium,
sous une politique de sécurité stricte :

```bash
npm run test:web
```

```bash
npm run test:wallet
```

`test:web` rejoue l'historique de démo à part pour vérifier les totaux affichés, vérifie que le reçu, la
décomposition et l'état du programme concordent au lamport près, déroule la visite guidée et contrôle cinq
largeurs d'écran. `test:wallet` connecte un faux Phantom à un faux cluster Solana (`web/mock-cluster.mjs` : les
méthodes JSON-RPC qu'utilise l'application, des comptes encodés exactement comme ceux du programme, les
transactions exécutées sur ses règles), puis achète, vend dans le parent, essuie un refus du wallet et un refus
du programme, s'engage dans une ouverture, lance un meme et retire son allocation.

**L'héberger soi-même.** Le workflow `.github/workflows/pages.yml` publie l'application sur GitHub Pages à
chaque push sur `main`. Il faut l'activer une fois : *Settings → Pages → Build and deployment → Source :
GitHub Actions*.

## Déployer sur Solana (devnet)

À faire depuis ton ordinateur (macOS ou Linux ; sous Windows, dans WSL). Le devnet est le réseau de test de
Solana : son SOL est gratuit et n'a aucune valeur. Pas de mainnet avant un audit.

1. **Installer les outils** (Rust, la CLI Solana et Anchor 0.31.1) avec la commande officielle d'Anza, puis
   rouvrir le terminal :

   ```bash
   curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
   ```

   ```bash
   avm install 0.31.1 && avm use 0.31.1
   ```

2. **Créer un wallet de déploiement** et lui donner du SOL de test (le faucet web
   [faucet.solana.com](https://faucet.solana.com) marche aussi si `airdrop` est limité) :

   ```bash
   solana-keygen new
   ```

   ```bash
   solana config set --url devnet
   ```

   ```bash
   solana airdrop 5
   ```

3. **Compiler et déployer** depuis le dossier `solana/`. `anchor build` crée l'adresse du programme,
   `anchor keys sync` l'écrit dans le code, et il faut recompiler avant de déployer :

   ```bash
   cd solana && anchor build && anchor keys sync && anchor build
   ```

   ```bash
   anchor deploy --provider.cluster devnet
   ```

   Le déploiement coûte environ 3 à 4 SOL de devnet (le loyer du programme).

4. **Initialiser le hub** et l'inscrire dans l'application, depuis la racine du dépôt. `--fee-recipient` est
   l'adresse qui recevra la part du protocole (0,2 %) ; elle ne pourra plus changer :

   ```bash
   npm install && node solana/scripts/initialize.mjs --fee-recipient <ton adresse>
   ```

5. **Vérifier que tout marche** sur le devnet avec le code même de l'application (lancement, ouverture,
   retrait, achat, vente, puis une variante et ses échanges à travers la lignée ; environ 12 minutes, quelques
   centièmes de SOL de test, et le coût en unités de calcul de chaque instruction) :

   ```bash
   node solana/scripts/smoke.mjs --variant
   ```

6. **Publier** : commiter `web/src/deployments.js` (écrit à l'étape 4) et pousser sur `main` ; GitHub Pages
   republie l'application avec le bouton « Connect wallet ».

Le programme n'a jamais été compilé pour la cible Solana (SBF) dans l'environnement où il a été écrit : ses tests
l'exécutent nativement dans le runtime Solana, avec les vrais programmes Token-2022 et Associated Token. Les
étapes 3 et 5 sont donc aussi son premier vrai test sur une chaîne ; si l'une échoue, son message suffit à
corriger.

## Le diagnostic

| Symptôme | Cause réelle |
|---|---|
| 50 tokens « PNUT » en 10 minutes | Créer un token ne coûte rien et rien ne relie un meme à *un* token |
| Les copies vident l'original | Chaque copie est un pool SOL concurrent : chaque SOL qui va à la copie n'ira jamais à l'original |
| Les bots snipent le premier bloc | Le premier acheteur obtient un prix que personne d'autre ne peut avoir |
| Les bots revendent sur la vague | Le moins cher des tokens est liquide immédiatement, pendant que la demande monte |
| Personne ne « gagne » au total | Une courbe de bonding est à somme nulle : tout SOL sorti a été mis par quelqu'un d'autre |

## Le mécanisme, en cinq pièces

1. **Un meme, un ticker.** Le ticker est normalisé (casse, ponctuation, leetspeak : `PNUT`, `$pnut`,
   `P.N.U.T`, `PNU7` sont le même meme), et l'adresse du token (son *mint*) est dérivée de ce ticker normalisé :
   un doublon ne peut tout simplement pas exister.
2. **Lignée (anti-vamp).** Une variante se lance *dans la famille* du meme qu'elle copie : sa courbe est
   cotée en token parent, pas en SOL. Acheter la copie, c'est d'abord acheter l'original (en une seule
   transaction), et l'argent qui sort d'une copie perdante retombe dans l'original au lieu de quitter le meme.
   Il n'y a qu'un seul pool de SOL par famille. Le créateur de l'original touche 0,8 % sur tout le volume qui
   traverse son meme (le 1 % de frais, moins la part du protocole).
3. **Ouverture équitable.** Les 5 premières minutes de chaque lancement sont une enchère groupée : tous
   les participants paient le même prix, créateur compris. Snipe et bundle du premier bloc n'achètent rien.
   Ces places, les moins chères, **vestent sur une heure** : impossible de les revendre sur la première vague.
4. **Part de pic.** Quand une vente s'exécute au-dessus du prix de référence (qui rattrape le prix réel en une
   heure), la moitié de l'excédent reste dans la réserve et fait monter le prix de tous les tokens restants :
   ceux qui vendent dans la vague paient ceux qui ont acheté la vague. Vendre patiemment, ou dans un marché
   qui baisse, ne coûte rien de plus que le 1 % de frais. Seule la partie de la vente exécutée au-dessus de
   la référence est comptée (intégrale fermée sur la courbe), donc un gros dump n'y échappe pas en écrasant
   son propre prix moyen.
5. **Union.** Deux memes rivaux (`PNUT` et `PEANUT`) peuvent fusionner au lieu de se battre. Les détenteurs
   de `PEANUT` votent en verrouillant leurs tokens (majorité de l'offre en circulation, vote de 3 jours) ;
   pendant le vote, les opposants peuvent sortir sur la courbe. Si le vote passe, toute la réserve de SOL de
   `PEANUT` achète du `PNUT` et la courbe de `PEANUT` est re-cotée en `PNUT` au taux obtenu : `PEANUT` garde
   son nom, ses détenteurs et leurs soldes, ses propres variantes suivent, et la famille n'a plus qu'un pool.

Socle commun : chaque token vit sur une courbe *constant product* à réserves virtuelles tenue par le
programme, sans propriétaire, sans clé admin, et sans paramètre modifiable après l'initialisation. Le programme
peut toujours racheter la totalité de l'offre en circulation de chaque token ; c'est l'invariant principal des
tests.

**Frais.** Chaque échange sur une courbe paie 1 % dans l'actif de cotation. Sur ce 1 %, `protocol_fee_bps`
(0,2 % de l'échange dans le déploiement prévu) va au destinataire du protocole, le reste (0,8 %) au créateur du
meme : la part du protocole sort du 1 %, elle ne s'y ajoute jamais. Les deux valeurs sont fixées à
l'initialisation et ne peuvent plus changer ; le code plafonne la part du protocole à 0,5 %, pour que le
créateur garde toujours au moins la moitié. Les ouvertures et les Unions ne paient pas de frais. Le destinataire
retire sa part avec `claim_fees`, comme un créateur.

## Ce que montre la simulation

`npm run simulate:web` (`web/simulate.mjs`) joue 10 fois le même scénario sur les règles du programme : un
original (`PNUT`, 24 acheteurs) puis 5 copies (10 acheteurs chacune), environ 1 800 SOL d'argent « retail » au
total. À chaque lancement : le créateur et un bot sniper entrent en premier (dans l'enchère groupée côté
Community Coin, avec la première moitié des acheteurs), puis le reste de la vague. Ensuite la retombée : le bot
vend tout ce qu'il peut, la moitié des acheteurs de la vague (les « paper hands ») vend derrière lui. Quand la
hype s'arrête, tout le monde vend ce qu'il reste dans un ordre aléatoire. Tout finit en SOL, donc la somme est
exactement nulle : la seule question est qui paie qui.

Les deux mondes paient le même 1 % de frais par échange, dont 0,2 % au protocole (`PROTOCOL=0` le retire).
Résultat moyen en SOL, le bot sortant à un moment aléatoire de la fin (personne ne sait où est le sommet) :

| | Aujourd'hui | Community Coin |
|---|---:|---:|
| Bot sniper | +1 590 | +1 394 |
| Créateur de l'original | +10,6 | +26,5 |
| Créateurs des copies | +29,9 | −43,6 |
| Acheteurs de l'original | −517 | **−208** |
| Acheteurs des copies | −1 121 | −1 178 |
| Protocole (0,2 %) | +8,5 | +8,1 |
| **Tout le retail** | −1 639 | **−1 385** |
| Somme (contrôle de somme nulle) | 0 | 0 |
| Pools de SOL pour le même meme | 6 | 1 |

Si le bot connaît le sommet et sort le premier, les chiffres bougent à peine (bot +1 398, retail −1 388).
Lancer une copie ne rapporte plus rien à celui qui la lance (+29,9 → −43,6) : le vamp cesse de payer.

Les mêmes règles **sans lignée** (copies lancées comme racines indépendantes, `LINEAGE=0`) : bot +802,
acheteurs de l'original −242, acheteurs des copies −565, **tout le retail −807**, soit deux fois moins de
pertes qu'aujourd'hui.

L'ablation (mêmes 10 scénarios, bot sortant au hasard ; `VEST=0`, `SPIKE=0`, `LINEAGE=0` retirent chaque pièce)
dit d'où vient chaque effet :

| Configuration | Bot | Acheteurs de l'original | Acheteurs des copies | Tout le retail |
|---|---:|---:|---:|---:|
| Aujourd'hui (courbes simples, pas de lignée) | +1 590 | −517 | −1 121 | −1 639 |
| Enchère d'ouverture seule | +1 387 | −428 | −947 | −1 375 |
| Enchère + part de pic | +1 280 | −392 | −880 | −1 272 |
| Enchère + vesting | +875 | −269 | −608 | −877 |
| Enchère + vesting + part de pic | +802 | −242 | −565 | −807 |
| Enchère + lignée | +1 628 | −427 | −1 189 | −1 616 |
| Tout (Community Coin) | +1 394 | −208 | −1 178 | −1 385 |

Ce qu'il faut en retenir, sans enjoliver :

- **Le vesting de l'ouverture est le vrai levier anti-PvP.** Il divise presque par deux le gain du bot et les
  pertes du retail. La part de pic ajoute un peu (elle vise surtout les acheteurs post-ouverture, qui ne sont
  pas vestés).
- **La lignée règle le vamp, pas le PvP.** Elle fait ce qu'elle promet : chaque copie nourrit l'original,
  les acheteurs de l'original perdent deux fois et demie moins qu'aujourd'hui, lancer une copie ne paie plus,
  et le meme n'a qu'un pool. Mais elle transfère aussi la demande des copies vers *tous* les détenteurs
  précoces de l'original, bots compris : un bot qui détient `PNUT` revend dans chaque vague de copie. Avec la
  lignée, les acheteurs de copies paient un péage à la famille et ne s'en sortent pas mieux qu'aujourd'hui.
- **Le bot reste gagnant dans tous les cas.** C'est la nature d'un marché à somme nulle : celui qui entre tôt
  et sort avant les autres gagne l'argent de ceux qui sortent après. Le protocole retire les avantages
  *privilégiés* (premier bloc, revente immédiate des places les moins chères, fragmentation) ; il ne peut pas
  retirer l'avantage d'être rapide et de vendre le premier. Toute personne qui promet le contraire vend
  quelque chose.

En clair : pour protéger le retail du PvP, ce sont l'ouverture groupée et le vesting qui comptent, et ils
devraient être la règle pour tous les lancements. La lignée est un choix de la communauté d'un meme qui veut
se protéger des copies : elle protège ses détenteurs, pas les acheteurs de copies. C'est pour ça qu'elle
reste optionnelle (le lanceur d'une variante choisit son parent, ou aucun).

Ces chiffres remplacent ceux de la version Base : sa simulation avançait l'horloge de Hardhat sans miner de bloc,
si bien que ses lectures ne voyaient pas le temps passer et que le bot ne retirait jamais ses tokens vestés lors
de la première retombée. C'est corrigé dans `scripts/simulate.js`, et les deux simulations concordent
maintenant à environ 1 % près (la moitié « aujourd'hui », qui ne dépend pas du temps, à l'identique).

## Ce que ça ne résout pas

- **Les vamps hors protocole.** Rien n'empêche de copier un meme sur un autre launchpad. Le protocole ne peut
  que rendre l'intérieur plus attractif : une variante lancée dans la famille hérite d'une communauté qui a
  intérêt à la pousser.
- **La somme nulle.** Voir plus haut. L'argent qui sort a été mis par quelqu'un d'autre.
- **Le dédoublonnage par ticker seul.** `PNUT` et `PEANUT` restent deux tickers ; c'est le rôle de l'Union.
  Un dédoublonnage par image ou par nom demanderait un oracle hors chaîne.
- **Le MEV sur l'exécution d'une Union.** Le gros achat de l'Union peut être sandwiché (bundles Jito) ;
  l'exécutant fixe un `min_target_in`, mais le risque existe.
- **L'audit.** Ce code n'est pas audité. Ne le déployez pas avec de l'argent réel en l'état.

## Le programme

`solana/programs/community-coin` : Anchor 0.31, tokens Token-2022 (6 décimales, métadonnées dans le mint).

| Instruction | Rôle |
|---|---|
| `launch(key, name, symbol, uri, sol_in)` | Lance un meme ; sa lignée (racine d'abord) en comptes restants pour une variante, aucune pour une racine cotée en SOL. Le SOL envoyé est engagé dans l'ouverture. |
| `commit_sol` / `commit` | Participer à l'enchère d'ouverture, en SOL routé par les ancêtres ou dans l'actif de cotation. |
| `settle` / `claim` | Clôturer l'ouverture (n'importe qui) ; retirer la part vestée de son allocation. |
| `buy_sol` / `buy` | Acheter avec du SOL routé à travers toute la lignée, ou avec l'actif de cotation. |
| `sell_to_sol` / `sell` | Vendre jusqu'au SOL, ou contre l'actif de cotation (le parent : l'argent reste dans la famille). |
| `claim_fees(protocol)` | Le créateur retire ses frais (0,8 %), le destinataire du protocole sa part (0,2 %), dans l'actif de cotation du meme. |
| `propose_union` / `lock_union` / `unlock_union` / `execute_union` | Le cycle de vote d'une Union. |

Comptes : `Config` (paramètres, fixés une fois par `initialize`), `Meme` (une courbe, à l'adresse dérivée de son
mint), `Commitment`, `Union`, `Lock`, et un unique coffre (`Vault`) qui détient tout le SOL dû. Les réserves des
variantes, les lots d'ouverture et les frais sont des nombres dans les comptes : les tokens correspondants ne
sont frappés qu'en sortant du hub (et brûlés quand ils y entrent), si bien que chaque token réel est dans un
wallet. Constantes : courbe de 1 milliard de tokens virtuels, 30 SOL virtuels pour une racine, 1 million de
tokens parents virtuels pour une variante, 1 % de frais, profondeur de lignée maximale de 6, 0,03 SOL de réserve
minimum pour une Union.

**Ce qui est vérifié :**

- `npm run test:solana` (`cargo test` dans `solana/`) : 16 tests de comportement et 4 marches aléatoires qui
  contrôlent les comptes à l'unité près à chaque étape (le SOL du coffre égale les réserves, lots et frais dus ;
  pour chaque token, ce que la courbe a vendu égale ce qui est dans les wallets, verrouillé dans les votes, pas
  encore retiré, ou détenu par les variantes), puis font sortir tout le monde jusqu'à une offre nulle ;
- `npm run test:protocol` : la réplique JavaScript des règles (`web/src/protocol.js`) rejoue l'historique de
  démo et une marche de 720 étapes à travers toutes les instructions, échecs compris, et doit trouver après
  chaque étape exactement le même état que le programme ;
- `npm run test:wire` : `web/src/solana.js` (adresses, instructions, comptes, événements) doit reproduire octet
  pour octet les transactions envoyées par les tests Rust, décoder les événements émis par le programme et
  relire chacun de ses comptes.

Les deux derniers lisent ce qu'écrit `cargo test` : lancer `npm run test:solana` d'abord.

## La version Base (référence)

`contracts/CommunityCoin.sol` et `contracts/MemeToken.sol`, leurs 28 tests (`npm test`), le simulateur sur les
contrats (`npm run simulate`) et le script de déploiement (`npm run deploy`) restent dans le dépôt : c'est la
spécification d'origine, dont le programme Solana reprend les règles et les noms. Node 22 ; le compilateur `solc`
est pris dans `node_modules`.

## Utiliser

```bash
npm install
```

```bash
npm run test:solana
```

```bash
npm run test:protocol && npm run test:wire
```

```bash
npm run simulate:web
```

Le simulateur accepte `SEEDS` (nombre de scénarios), et pour l'ablation `VEST`, `SPIKE` et `LINEAGE` :

```bash
VEST=0 SPIKE=0 LINEAGE=1 SEEDS=5 node web/simulate.mjs
```

## La suite

- Le premier déploiement sur le devnet, et la mesure des unités de calcul des routes les plus profondes.
- Une sortie de courbe vers un AMM (Raydium ou Meteora), avec la part de pic en frais dynamiques.
- Étendre le vesting aux achats de la première heure, pas seulement à l'ouverture : c'est ce que suggère
  l'ablation.
- Fuzzing et vérification formelle de l'invariant de solvabilité ; audit.

*Ceci est un prototype de recherche, pas un conseil financier. Les memecoins sont des actifs spéculatifs à
somme nulle ; la plupart des participants y perdent de l'argent.*
