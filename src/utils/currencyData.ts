// Map of ISO country codes to currency codes
// Source: https://www.iban.com/currency-codes
export const countryCurrencyMap: Record<string, string> = {
  // Africa
  NG: 'NGN', ZA: 'ZAR', EG: 'EGP', KE: 'KES', GH: 'GHS', MA: 'MAD', DZ: 'DZD', 
  TN: 'TND', SN: 'XOF', CI: 'XOF', CM: 'XAF', UG: 'UGX', TZ: 'TZS', RW: 'RWF',
  // Europe
  GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CH: 'CHF', RU: 'RUB',
  // Asia
  CN: 'CNY', JP: 'JPY', IN: 'INR', KR: 'KRW', SG: 'SGD', MY: 'MYR', ID: 'IDR',
  TH: 'THB', VN: 'VND', PH: 'PHP', PK: 'PKR', BD: 'BDT', LK: 'LKR',
  // North America
  US: 'USD', CA: 'CAD', MX: 'MXN',
  // South America
  BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  // Oceania
  AU: 'AUD', NZ: 'NZD',
  // Default
  DEFAULT: 'USD'
};

export function getCurrencyCode(countryCode: string): string {
  return countryCurrencyMap[countryCode.toUpperCase()] || countryCurrencyMap.DEFAULT;
}