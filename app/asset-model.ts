export type LegacyTokenId="ethfi"|"bp"|"pendle"|"hype";
export type ExpandedTokenId="uni"|"aave"|"ena"|"xpl";
export type TokenId=LegacyTokenId|ExpandedTokenId;

export type ExpandedAssetSnapshot={
  id:ExpandedTokenId;
  name:string;
  project:string;
  category:string;
  color:string;
  price:number|null;
  change24h:number|null;
  marketCap:number|null;
  fdv:number|null;
  volume24h:number|null;
  circulatingSupply:number|null;
  totalSupply:number|null;
  overallSupply:number|null;
  burnedSupply:number|null;
  burnedMethod:string;
  burn30d?:number|null;
  burn90d?:number|null;
  burnPeriodSource?:string;
  unlockEvents?:Array<{date:string;amount:number;label:string;beneficiary:string;source:string}>;
  buybackStatus?:string;
  stakingAmount:number|null;
  stakingApplicable:boolean;
  stakingLabel:string;
  stakingExit:string;
  businessLabel:string;
  businessValue:number|null;
  valueCapture:string;
  pressure:string;
  risk:string;
  chart:Array<[number,number]>;
  marketSource:string;
  stakingSource:string;
  businessSource:string;
  failedSources:string[];
  updatedAt:string;
};

export type ExpandedAssetsResponse={assets:ExpandedAssetSnapshot[];updatedAt:string};

export const expandedAssetMeta:Record<ExpandedTokenId,{name:string;project:string;color:string}>={
  uni:{name:"UNI",project:"Uniswap",color:"#ff4d9d"},
  aave:{name:"AAVE",project:"Aave",color:"#7b61ff"},
  ena:{name:"ENA",project:"Ethena",color:"#24262b"},
  xpl:{name:"XPL",project:"Plasma",color:"#17b890"},
};
