// Demo fixtures: the people, the ideas in tonight's race, the other lobbies of the hour and the clans the demo
// account founded. The coins are real memecoins with their real stories; amounts, members and price moves are made up
// for the demo and never shown outside it.

export const ASSETS = "assets";

// People and the hue of their fallback avatar (shown while the photo loads, or if it fails).
export const PEOPLE = {
  "mira.sol": { hue: 90, photo: "mira" },
  kai: { hue: 340, photo: "kai" },
  lune: { hue: 265, photo: "lune" },
  ocean: { hue: 205, photo: "ocean" },
  remi: { hue: 45, photo: "remi" },
  nox: { hue: 172, photo: "nox" },
  sol_jo: { hue: 18, photo: "soljo" },
  ivy: { hue: 150, photo: "ivy" },
  pixel: { hue: 300, photo: "pixel" },
  chef: { hue: 30, photo: "chef" },
  you: { hue: 52, photo: "you", name: "degen_marc" },
  ari: { hue: 120, photo: "ari" },
  bo: { hue: 230, photo: "bo" },
  zed: { hue: 0, photo: "zed" },
  juno: { hue: 280, photo: "juno" },
  tao: { hue: 190, photo: "tao" },
  uma: { hue: 60, photo: "uma" },
};
export const ME = "you";
export const CROWD = ["ari", "bo", "zed", "juno", "tao", "uma", "ivy", "pixel", "chef"];
export const SPEAKERS = ["mira.sol", "kai", "lune", "ocean", "remi", "sol_jo"];
export const MUTED_SPEAKERS = ["ocean", "sol_jo"];
export const CAMPFIRE = ["kai", "sol_jo", "lune", "remi", "ivy"];

export const CHATTER = [
  "brett is undefeated on base",
  "the beanie is iconic, ngl",
  "who is pitching next?",
  "mew comeback incoming",
  "I came for the vibes, staying for the coin",
  "host can we get one more pitch",
  "my whole group chat is in here lol",
  "floki is criminally underrated",
];

// Ideas in the race of the featured lobby. `sol` and `backers` are the crowd's pledges at the start of the demo.
export const IDEAS = [
  { id: "wif", name: "dogwifhat", ticker: "WIF", hue: 30, by: "kai", sol: 171.2, backers: 398, logo: "wif",
    pitch: "Literally a dog wif a hat. A Shiba Inu in a pink knit beanie, nothing more, nothing less." },
  { id: "popcat", name: "Popcat", ticker: "POPCAT", hue: 330, by: "lune", sol: 118.6, backers: 281, logo: "popcat",
    pitch: "Oatmeal the cat and the mouth that pops wide open. The Pop Cat meme, as a coin." },
  { id: "mew", name: "cat in a dogs world", ticker: "MEW", hue: 355, by: "ocean", sol: 70.4, backers: 190, logo: "mew",
    pitch: "One cat against a market full of dogs. Every dog coin is the villain of its story." },
  { id: "brett", name: "Brett", ticker: "BRETT", hue: 210, by: "remi", sol: 49.9, backers: 133, logo: "brett",
    pitch: "Pepe’s best friend from Matt Furie’s Boy’s Club comic, the blue mascot of Base." },
  { id: "floki", name: "Floki", ticker: "FLOKI", hue: 28, by: "sol_jo", sol: 36.5, backers: 92, logo: "floki",
    pitch: "Named after Elon Musk’s Shiba Inu. A Viking dog in a horned helmet with big plans." },
];

export const FEATURED = { id: "fnd", name: "Friday Night Degens", host: "mira.sol", theme: "animal coins only", inside: 1284, listeners: 306, number: "0412" };

// Other lobbies of the hour. `offset` shifts their clock against the featured one; `opens` marks upcoming ones.
export const LOBBIES = [
  { id: "ram", name: "Midnight Ramen Club", theme: "Food coins only. Every pitch comes with a photo.", host: "chef.ko", offset: 1660, inside: 2031, pledged: 1120 },
  { id: "par", name: "Paris Shitpost Assembly", theme: "French memes, French jokes, no translation.", host: "baguette", offset: 240, inside: 846, pledged: 412 },
  { id: "frg", name: "Frog Council", theme: "Every idea must contain a frog. No exceptions.", host: "ribbit", offset: -980, inside: 598, pledged: 96 },
  { id: "bld", name: "Builders After Dark", theme: "Coins with a real side project behind them.", host: "shipit", offset: -1300, inside: 214, pledged: 0 },
  { id: "arc", name: "Retro Arcade Hour", theme: "8-bit mascots, chiptune pitches on stage.", host: "pixel", opens: "21:00", waiting: 133 },
  { id: "cat", name: "Sunday Cat Tribunal", theme: "Cats judge your coin. The cats are final.", host: "meow", opens: "22:00", waiting: 402 },
];

export const CLANS = [
  { id: "bonk", name: "Bonk", ticker: "BONK", hue: 35, logo: "bonk", members: 1102, born: "Born Oct 24", change: 18.4, voice: 14, unread: 23,
    story: "Solana’s first dog coin, airdropped to the community on Christmas Day 2022." },
  { id: "doge", name: "Dogecoin", ticker: "DOGE", hue: 45, logo: "doge", members: 2388, born: "Born Oct 11", change: 2.0, voice: 41, unread: 0,
    story: "Created in 2013 by Billy Markus and Jackson Palmer as a joke. The original memecoin." },
  { id: "shib", name: "Shiba Inu", ticker: "SHIB", hue: 15, logo: "shib", members: 640, born: "Born Oct 19", change: -4.1, voice: 3, unread: 7,
    story: "Launched in 2020 by the pseudonymous Ryoshi and billed as the “Dogecoin killer”." },
];

export const CHANNELS = [
  { id: "general", topic: "Talk about anything. Be kind to the mascot.", unread: 0 },
  { id: "memes", topic: "Images and clips. Best of the week goes on the birth card.", unread: 0 },
  { id: "alpha", topic: "Charts, listings, partnerships.", unread: 12 },
  { id: "art-lab", topic: "Mascot work in progress.", unread: 4 },
  { id: "next-lobby", topic: "Plan the clan’s next launch together.", unread: 2 },
];

export const FOUNDERS = [
  ["sol_jo", 12, 3], ["kai", 8.5, 1], ["lune", 6, 8], ["ivy", 4.2, 97], ["ocean", 3, 140], ["nox", 2.5, 61], ["remi", 2, 22],
];

export const ROLES = { "mira.sol": "host", kai: "creator" };

let nextId = 100;
export const newId = () => ++nextId;

export function message(who, text, extra = {}) {
  return { id: newId(), who, text, t: "now", media: [], hearts: 0, fires: 0, heartOn: false, fireOn: false, ...extra };
}

export function seedClanMessages() {
  return {
    general: [
      message("mira.sol", "gg everyone. This room is yours now, forever. Rules are pinned.", { t: "01:01", hearts: 212 }),
      message("ocean", "my idea lost but I pledged on the winner as a hedge. hello family", { t: "01:03", hearts: 33, fires: 4 }),
      message("remi", "founders stage is Sunday 20:00, bring a pitch for the next one", { t: "01:16", fires: 19 }),
    ],
    memes: [
      message("kai", "first batch from launch night. the gold one goes on the birth card", { t: "01:12", hearts: 41, fires: 18, media: [{ hue: 340 }, { hue: 45 }, { hue: 205, video: true }] }),
      message("lune", "came for popcat, stayed for this. no regrets", { t: "01:14", hearts: 27 }),
      message("ivy", "proposal: clan lobby next friday, we launch a sidekick coin together?", { t: "01:23", hearts: 64, fires: 31 }),
    ],
    alpha: [message("sol_jo", "volume is 3x the lobby average. holding the line.", { t: "01:30", fires: 22 })],
    "art-lab": [message("kai", "working on a 3D version of the mascot, early wip", { t: "01:40", media: [{ hue: 340 }], hearts: 12 })],
    "next-lobby": [message("ivy", "drop sidekick ideas here, we vote in voice on sunday", { t: "01:44", hearts: 9 })],
  };
}

export function seedLobbyChat() {
  return [
    { sys: true, kind: "propose", text: "@sol_jo proposed $FLOKI · Floki" },
    { who: "kai", text: "the hat stays on. thoughts?", art: "wif", badge: "pitched $WIF" },
    { who: "lune", text: "cute, but popcat is louder. literally." },
    { sys: true, kind: "pledge", text: "@ari pledged 4 SOL to $WIF" },
    { who: "remi", text: "reminder: losing pledges are refunded at lock, no stress", badge: "mod" },
  ];
}

// View shapes for the components: a person and a coin, with their asset paths.
export function person(who) {
  const p = PEOPLE[who] || { hue: (who.length * 47) % 360 };
  return { id: who, name: p.name || who, hue: p.hue, src: p.photo ? `${ASSETS}/people/${p.photo}.jpg` : null };
}

export function coin(c) {
  return { ticker: c.ticker, hue: c.hue, name: c.name, logo: c.logo ? `${ASSETS}/coins/${c.logo}.png` : null };
}
