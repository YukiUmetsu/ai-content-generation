/** Finance/business visual vocabulary. Each semantic ID maps to one reusable
 * geometric archetype, not a separate renderer, camera or timeline.
 * No real account numbers, brand marks or financial credentials are synthesized.
 */
export const FINANCE_OBJECTS=[
  {kind:"bank",title:"Bank",archetype:"institution"},
  {kind:"bank-branch",title:"Bank branch",archetype:"institution"},
  {kind:"investment-bank",title:"Investment bank",archetype:"institution"},
  {kind:"bank-account",title:"Bank account",archetype:"account"},
  {kind:"checking-account",title:"Checking account",archetype:"account"},
  {kind:"savings-account",title:"Savings account",archetype:"account"},
  {kind:"credit-card",title:"Credit card",archetype:"card"},
  {kind:"debit-card",title:"Debit card",archetype:"card"},
  {kind:"gift-card",title:"Gift card",archetype:"card"},
  {kind:"atm",title:"ATM",archetype:"terminal"},
  {kind:"payment-terminal",title:"Payment terminal",archetype:"terminal"},
  {kind:"cash-register",title:"Cash register",archetype:"terminal"},
  {kind:"loan",title:"Loan",archetype:"document"},
  {kind:"loan-agreement",title:"Loan agreement",archetype:"document"},
  {kind:"contract",title:"Contract",archetype:"document"},
  {kind:"invoice",title:"Invoice",archetype:"document"},
  {kind:"receipt",title:"Receipt",archetype:"document"},
  {kind:"tax-return",title:"Tax return",archetype:"document"},
  {kind:"insurance-policy",title:"Insurance policy",archetype:"document"},
  {kind:"dollar",title:"US dollar",archetype:"cash"},
  {kind:"banknote",title:"Banknote",archetype:"cash"},
  {kind:"cash-stack",title:"Cash stack",archetype:"cash"},
  {kind:"coin",title:"Coin",archetype:"coin"},
  {kind:"coins",title:"Coins",archetype:"coin"},
  {kind:"interest",title:"Interest",archetype:"coin"},
  {kind:"wallet",title:"Wallet",archetype:"wallet"},
  {kind:"piggy-bank",title:"Piggy bank",archetype:"piggy"},
  {kind:"safe",title:"Safe",archetype:"vault"},
  {kind:"vault",title:"Vault",archetype:"vault"},
  {kind:"house",title:"House",archetype:"house"},
  {kind:"mortgage",title:"Mortgage",archetype:"house"},
  {kind:"storefront",title:"Storefront",archetype:"store"},
  {kind:"business",title:"Business",archetype:"store"},
  {kind:"briefcase",title:"Briefcase",archetype:"briefcase"},
  {kind:"investment",title:"Investment",archetype:"chart"},
  {kind:"stock",title:"Stock market",archetype:"chart"},
  {kind:"growth",title:"Growth",archetype:"chart"},
  {kind:"profit",title:"Profit",archetype:"chart"},
  {kind:"loss",title:"Loss",archetype:"chart"},
  {kind:"calculator",title:"Calculator",archetype:"calculator"},
  {kind:"budget",title:"Budget",archetype:"calculator"},
  {kind:"insurance",title:"Insurance",archetype:"shield"},
  {kind:"risk",title:"Risk",archetype:"shield"},
  {kind:"transfer",title:"Money transfer",archetype:"transfer"},
  {kind:"transaction",title:"Transaction",archetype:"transfer"},
  {kind:"currency-exchange",title:"Currency exchange",archetype:"transfer"},
  {kind:"handshake",title:"Handshake",archetype:"handshake"},
  {kind:"partnership",title:"Partnership",archetype:"handshake"},
  {kind:"repayment",title:"Repayment schedule",archetype:"calendar"},
  {kind:"payday",title:"Payday",archetype:"calendar"},
  {kind:"stock-workstation",title:"Stock trading workstation",archetype:"workstation"},
  {kind:"stock-chart",title:"Stock price chart",archetype:"workstation"},
  {kind:"corporate-office",title:"Corporate headquarters",archetype:"corporate"},
  {kind:"money-printing-press",title:"Currency printing press",archetype:"press"},
  {kind:"money-bag",title:"Money bag",archetype:"bag"},
  {kind:"bank-check",title:"Bank check",archetype:"check"},
  {kind:"bull-market",title:"Bull market",archetype:"bull"},
  {kind:"bear-market",title:"Bear market",archetype:"bear"},
  {kind:"financial-dashboard",title:"Financial dashboard",archetype:"workstation"},
  {kind:"retail-store",title:"Retail store",archetype:"store"},
  {kind:"corporate",title:"Corporation",archetype:"corporate"},
  {kind:"gold-bars",title:"Gold bars",archetype:"coin"},
] as const;
export type FinanceObjectKind=typeof FINANCE_OBJECTS[number]["kind"];
export type FinanceObjectArchetype=typeof FINANCE_OBJECTS[number]["archetype"];
export interface FinancialCandle {
  open:number;
  high:number;
  low:number;
  close:number;
}
/** Illustrative, not sourced from real markets; no fake real-time feeds. */
export const ILLUSTRATIVE_MARKET_CANDLES:readonly FinancialCandle[]=[
  {open:41,high:44,low:40,close:43},{open:43,high:46,low:42,close:45},
  {open:45,high:47,low:41,close:42},{open:42,high:43,low:39,close:40},
  {open:40,high:44,low:39,close:43},{open:43,high:45,low:42,close:44},
  {open:44,high:49,low:43,close:48},{open:48,high:50,low:46,close:47},
  {open:47,high:51,low:45,close:50},{open:50,high:53,low:48,close:52},
  {open:52,high:54,low:48,close:49},{open:49,high:54,low:48,close:53},
];
export interface FinanceObjectSpec {
  kind:FinanceObjectKind;
  id:string;
  /** Visible title for narration/storyboard; not a real institution logo. */
  title?:string;
  accent?:string;
  /** Optional validated OHLC observations for stock-workstation, stock-chart and
   * financial-dashboard. Defaults to labeled illustrative data otherwise.
   */
  marketCandles?:readonly FinancialCandle[];
  /** Optional conceptual data, never real account credentials. */
  state?:"idle"|"active"|"complete";
}
export interface ResolvedFinanceObject extends FinanceObjectSpec {
  title:string;
  archetype:FinanceObjectArchetype;
}
export function resolveFinanceObject(spec:FinanceObjectSpec):ResolvedFinanceObject {
  const descriptor=FINANCE_OBJECTS.find(entry=>entry.kind===spec?.kind);
  if(!descriptor)throw new Error("Unsupported financial object kind.");
  if(!spec.id||!/^[-a-zA-Z0-9_]{1,72}$/.test(spec.id))
    throw new Error("Finance object needs a stable ASCII semantic ID (1–72 characters).");
  const title=spec.title??descriptor.title;
  if(!title.trim()||title.length>52)
    throw new Error("Finance object title must be 1–52 characters.");
  if(spec.accent&&!/^#[0-9A-Fa-f]{6}$/.test(spec.accent))
    throw new Error("Finance object accent must be six-digit hex.");
  if(spec.state!==undefined&&
     !["idle","active","complete"].includes(spec.state))
    throw new Error("Unsupported financial object state.");
  if(spec.marketCandles!==undefined){
    if(!["workstation"].includes(descriptor.archetype))
      throw new Error("Only stock chart/workstation components accept OHLC candles.");
    if(!Array.isArray(spec.marketCandles)||spec.marketCandles.length<5||
       spec.marketCandles.length>40)
      throw new Error("Stock chart needs 5–40 OHLC observations.");
    for(const candle of spec.marketCandles){
      if(!candle||![candle.open,candle.close,candle.high,candle.low].every(
        value=>Number.isFinite(value)&&value>=0)||
        candle.low>Math.min(candle.open,candle.close)||
        candle.high<Math.max(candle.open,candle.close)||
        candle.high<candle.low)
        throw new Error("Invalid stock candle: high/low must contain open and close, all values finite and nonnegative.");
    }
  }
  return {...spec,title,archetype:descriptor.archetype};
}
export function financeObjectProgress(frame:number,startFrame=0,durationFrames=20):number{
  if(!Number.isSafeInteger(frame)||!Number.isSafeInteger(startFrame)||
     !Number.isSafeInteger(durationFrames)||durationFrames<1||startFrame<0)
    throw new Error("Finance object reveal requires integer absolute frames.");
  const t=Math.max(0,Math.min(1,(frame-startFrame)/durationFrames));
  return t*t*(3-2*t);
}
