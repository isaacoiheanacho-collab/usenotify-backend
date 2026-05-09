// Simple mapping from country code (ISO 3166-1 alpha-2) to currency code
// Fallback to USD for any missing country
const countryCurrencyMap: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN',
  GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', PT: 'EUR', IE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR',
  NG: 'NGN', ZA: 'ZAR', KE: 'KES', GH: 'GHS', EG: 'EGP', MA: 'MAD', TN: 'TND', DZ: 'DZD',
  IN: 'INR', CN: 'CNY', JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', ID: 'IDR', TH: 'THB', VN: 'VND', PH: 'PHP', PK: 'PKR', BD: 'BDT',
  AU: 'AUD', NZ: 'NZD',
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  // Add more as needed – but fallback will handle missing ones
};

// Regional margins (percentage)
const regionMargins: Record<string, number> = {
  AF: 3,   // Africa
  AS: 2,   // Asia
  EU: 1,   // Europe
  NA: 0,   // North America
  SA: 0,   // South America
  OC: 0,   // Oceania
};

function getRegion(countryCode: string): string {
  const africa = ['NG','ZA','KE','GH','EG','MA','TN','DZ','AO','CM','CI','ET','TZ','UG','ZM','ZW','SN','ML','BF','BJ','RW','UG','ZM'];
  const europe = ['GB','DE','FR','IT','ES','NL','BE','PT','IE','AT','FI','GR','SE','NO','DK','CH','PL','CZ','HU','RO','BG','HR','RS','SK','SI','LT','LV','EE','IS','LU','MT','CY'];
  const asia = ['IN','CN','JP','KR','SG','MY','ID','TH','VN','PH','PK','BD','LK','NP','KH','LA','MM','MN','UZ','KZ','AZ','GE','AM','IL','SA','AE','KW','QA','BH','OM','JO','LB','YE'];
  const northAmerica = ['US','CA','MX'];
  const southAmerica = ['BR','AR','CL','CO','PE','UY','PY','BO','EC','VE','GY','SR'];
  const oceania = ['AU','NZ','FJ','PG','SB','VU','WS'];

  if (africa.includes(countryCode)) return 'AF';
  if (europe.includes(countryCode)) return 'EU';
  if (asia.includes(countryCode)) return 'AS';
  if (northAmerica.includes(countryCode)) return 'NA';
  if (southAmerica.includes(countryCode)) return 'SA';
  if (oceania.includes(countryCode)) return 'OC';
  return 'EU';
}

export interface CurrencyInfo {
  currency: string;
  margin: number;
}

export function getCurrencyForCountry(countryCode: string): CurrencyInfo {
  const currency = countryCurrencyMap[countryCode.toUpperCase()] || 'USD';
  const region = getRegion(countryCode.toUpperCase());
  const margin = regionMargins[region] ?? 1;
  return { currency, margin };
}