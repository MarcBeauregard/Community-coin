// Typed access to the CommunityCoin hub and its meme tokens, over either chain.

import { Interface, ZeroAddress } from "ethers";
import contracts from "./contracts.json";
import { Reverted } from "./chain.js";

export const hubAbi = new Interface(contracts.CommunityCoin.abi);
export const tokenAbi = new Interface(contracts.MemeToken.abi);

const MESSAGES = {
  MemeExists: "Ce ticker existe déjà : achète l'original ou lance une variante.",
  UnknownMeme: "Ce meme n'existe pas.",
  InvalidSymbol: "Ticker invalide : il faut 1 à 16 lettres ou chiffres.",
  TooDeep: "Lignée trop profonde : 6 niveaux au maximum.",
  OpeningClosed: "L'ouverture est terminée : achète directement sur la courbe.",
  StillOpening: "L'ouverture est encore en cours : engage-toi dans l'enchère ou attends sa clôture.",
  AlreadySettled: "L'ouverture est déjà clôturée.",
  NothingToClaim: "Rien à retirer pour l'instant.",
  ZeroAmount: "Le montant doit être supérieur à zéro.",
  WrongValue: "Montant ETH incohérent avec la cotation de ce meme.",
  Slippage: "Le prix a bougé au-delà de ta tolérance. Réessaie.",
  NotRoot: "Seul un meme racine (coté en ETH) peut rejoindre une autre famille.",
  CycleDetected: "Impossible : ces deux memes sont déjà dans la même famille.",
  UnknownUnion: "Cette proposition d'Union n'existe pas.",
  VotingOpen: "Le vote est encore ouvert : l'Union s'exécute après la date limite.",
  VotingClosed: "Le vote est clos.",
  QuorumNotReached: "Majorité non atteinte : plus de la moitié de l'offre en circulation doit être verrouillée.",
  ReserveTooSmall: "Réserve trop petite pour une Union (0,001 ETH minimum).",
  EthTransferFailed: "Le transfert d'ETH a échoué.",
  ERC20InsufficientBalance: "Solde de tokens insuffisant.",
};

export function explain(error) {
  if (!(error instanceof Reverted)) return error?.shortMessage ?? error?.message ?? String(error);
  if (error.reason === "insufficient balance") return "Solde ETH insuffisant.";
  for (const abi of [hubAbi, tokenAbi]) {
    try {
      const parsed = abi.parseError(error.data);
      if (parsed) return MESSAGES[parsed.name] ?? parsed.name;
    } catch {}
  }
  return "Transaction refusée par le contrat.";
}

export class Hub {
  static async deploy(chain, from, args) {
    const data = contracts.CommunityCoin.bytecode + hubAbi.encodeDeploy(args).slice(2);
    return new Hub(chain, await chain.deploy(from, data));
  }

  constructor(chain, address) {
    this.chain = chain;
    this.address = address;
  }

  async read(fn, args = []) {
    const ret = await this.chain.call(ZeroAddress, this.address, hubAbi.encodeFunctionData(fn, args));
    const out = hubAbi.decodeFunctionResult(fn, ret);
    return out.length === 1 ? out[0] : out;
  }

  async token(token, fn, args = []) {
    const ret = await this.chain.call(ZeroAddress, token, tokenAbi.encodeFunctionData(fn, args));
    const out = tokenAbi.decodeFunctionResult(fn, ret);
    return out.length === 1 ? out[0] : out;
  }

  /** Sends a transaction and returns the hub events it emitted. */
  async write(from, fn, args = [], value = 0n) {
    const receipt = await this.chain.send(from, this.address, hubAbi.encodeFunctionData(fn, args), value);
    const events = [];
    for (const log of receipt.logs) {
      if (log.address !== this.address) continue;
      try {
        events.push(hubAbi.parseLog(log));
      } catch {}
    }
    return { events, timestamp: receipt.timestamp };
  }
}
