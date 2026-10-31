export function americanMoneyline(value){
 if(value==null||String(value).trim()==='')return null;
 const text=String(value).trim();
 if(!/^[+-]?\d+$/.test(text))return null;
 const number=Number(text);
 return Number.isFinite(number)&&Math.abs(number)>=100?(number>0?`+${number}`:String(number)):null;
}
export function espnMoneyline(odds,side){
 return americanMoneyline(odds?.moneyline?.[side]?.close?.odds??odds?.moneyline?.[side]?.current?.odds??odds?.[side+'TeamOdds']?.moneyLine);
}
