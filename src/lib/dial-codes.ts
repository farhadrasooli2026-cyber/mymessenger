/** Public ITU dialing metadata. Not a secret. */

export type DialCountry = {
  iso: string;
  name: string;
  nativeName: string;
  dial: string;
  nsnMin: number;
  nsnMax: number;
  aliases: string[];
  /** If set, national subscriber number (after trunk/dial strip) must match. */
  nsnPattern?: RegExp;
};

type Row = [string, string, string, string, number, number, string?, string?];

const RAW: Row[] = [
  ["AF", "Afghanistan", "افغانستان", "93", 9, 9, "افغان"],
  ["AL", "Albania", "Shqipëria", "355", 8, 9],
  ["DZ", "Algeria", "الجزائر", "213", 8, 9],
  ["AD", "Andorra", "Andorra", "376", 6, 9],
  ["AO", "Angola", "Angola", "244", 9, 9],
  ["AR", "Argentina", "Argentina", "54", 10, 11],
  ["AM", "Armenia", "Հայաստան", "374", 8, 8],
  ["AU", "Australia", "Australia", "61", 9, 9],
  ["AT", "Austria", "Österreich", "43", 10, 13],
  ["AZ", "Azerbaijan", "Azərbaycan", "994", 9, 9],
  ["BH", "Bahrain", "البحرين", "973", 8, 8],
  ["BD", "Bangladesh", "বাংলাদেশ", "880", 10, 10],
  ["BY", "Belarus", "Беларусь", "375", 9, 9],
  ["BE", "Belgium", "België", "32", 8, 9],
  ["BZ", "Belize", "Belize", "501", 7, 7],
  ["BJ", "Benin", "Bénin", "229", 8, 8],
  ["BT", "Bhutan", "འབྲུག", "975", 8, 8],
  ["BO", "Bolivia", "Bolivia", "591", 8, 8],
  ["BA", "Bosnia and Herzegovina", "Bosna", "387", 8, 8],
  ["BW", "Botswana", "Botswana", "267", 7, 8],
  ["BR", "Brazil", "Brasil", "55", 10, 11],
  ["BN", "Brunei", "Brunei", "673", 7, 7],
  ["BG", "Bulgaria", "България", "359", 8, 9],
  ["BF", "Burkina Faso", "Burkina Faso", "226", 8, 8],
  ["BI", "Burundi", "Burundi", "257", 8, 8],
  ["KH", "Cambodia", "កម្ពុជា", "855", 8, 9],
  ["CM", "Cameroon", "Cameroun", "237", 8, 9],
  ["CA", "Canada", "Canada", "1", 10, 10],
  ["CV", "Cape Verde", "Cabo Verde", "238", 7, 7],
  ["CF", "Central African Republic", "RCA", "236", 8, 8],
  ["TD", "Chad", "Tchad", "235", 8, 8],
  ["CL", "Chile", "Chile", "56", 9, 9],
  ["CN", "China", "中国", "86", 11, 11],
  ["CO", "Colombia", "Colombia", "57", 10, 10],
  ["KM", "Comoros", "جزر القمر", "269", 7, 7],
  ["CG", "Congo", "Congo", "242", 9, 9],
  ["CD", "Congo (DRC)", "RDC", "243", 9, 9],
  ["CR", "Costa Rica", "Costa Rica", "506", 8, 8],
  ["HR", "Croatia", "Hrvatska", "385", 8, 9],
  ["CU", "Cuba", "Cuba", "53", 8, 8],
  ["CY", "Cyprus", "Κύπρος", "357", 8, 8],
  ["CZ", "Czechia", "Česko", "420", 9, 9],
  ["DK", "Denmark", "Danmark", "45", 8, 8],
  ["DJ", "Djibouti", "جيبوتي", "253", 8, 8],
  ["DO", "Dominican Republic", "República Dominicana", "1", 10, 10],
  ["EC", "Ecuador", "Ecuador", "593", 9, 9],
  ["EG", "Egypt", "مصر", "20", 10, 10],
  ["SV", "El Salvador", "El Salvador", "503", 8, 8],
  ["GQ", "Equatorial Guinea", "Guinea Ecuatorial", "240", 9, 9],
  ["ER", "Eritrea", "ኤርትራ", "291", 7, 7],
  ["EE", "Estonia", "Eesti", "372", 7, 8],
  ["SZ", "Eswatini", "Eswatini", "268", 8, 8],
  ["ET", "Ethiopia", "ኢትዮጵያ", "251", 9, 9],
  ["FI", "Finland", "Suomi", "358", 9, 10],
  ["FR", "France", "France", "33", 9, 9, "فرانسه"],
  ["GA", "Gabon", "Gabon", "241", 7, 8],
  ["GM", "Gambia", "Gambia", "220", 7, 7],
  ["GE", "Georgia", "საქართველო", "995", 9, 9],
  ["DE", "Germany", "Deutschland", "49", 10, 13, "آلمان"],
  ["GH", "Ghana", "Ghana", "233", 9, 9],
  ["GR", "Greece", "Ελλάδα", "30", 10, 10],
  ["GT", "Guatemala", "Guatemala", "502", 8, 8],
  ["GN", "Guinea", "Guinée", "224", 9, 9],
  ["GW", "Guinea-Bissau", "Guiné-Bissau", "245", 7, 9],
  ["GY", "Guyana", "Guyana", "592", 7, 7],
  ["HT", "Haiti", "Haïti", "509", 8, 8],
  ["HN", "Honduras", "Honduras", "504", 8, 8],
  ["HK", "Hong Kong", "香港", "852", 8, 8],
  ["HU", "Hungary", "Magyarország", "36", 8, 9],
  ["IS", "Iceland", "Ísland", "354", 7, 7],
  ["IN", "India", "भारत", "91", 10, 10],
  ["ID", "Indonesia", "Indonesia", "62", 9, 12],
  ["IR", "Iran", "ایران", "98", 10, 10, "ايران,Persia"],
  ["IQ", "Iraq", "العراق", "964", 10, 10],
  ["IE", "Ireland", "Éire", "353", 9, 9],
  ["IL", "Israel", "ישראל", "972", 8, 9],
  ["IT", "Italy", "Italia", "39", 9, 11],
  ["CI", "Ivory Coast", "Côte d'Ivoire", "225", 10, 10],
  ["JM", "Jamaica", "Jamaica", "1", 10, 10],
  ["JP", "Japan", "日本", "81", 10, 10],
  ["JO", "Jordan", "الأردن", "962", 9, 9],
  ["KZ", "Kazakhstan", "Қазақстан", "7", 10, 10],
  ["KE", "Kenya", "Kenya", "254", 9, 9],
  ["KW", "Kuwait", "الكويت", "965", 8, 8],
  ["KG", "Kyrgyzstan", "Кыргызстан", "996", 9, 9],
  ["LA", "Laos", "ລາວ", "856", 8, 10],
  ["LV", "Latvia", "Latvija", "371", 8, 8],
  ["LB", "Lebanon", "لبنان", "961", 7, 8],
  ["LS", "Lesotho", "Lesotho", "266", 8, 8],
  ["LR", "Liberia", "Liberia", "231", 7, 9],
  ["LY", "Libya", "ليبيا", "218", 9, 9],
  ["LT", "Lithuania", "Lietuva", "370", 8, 8],
  ["LU", "Luxembourg", "Luxembourg", "352", 9, 9],
  ["MO", "Macao", "澳門", "853", 8, 8],
  ["MG", "Madagascar", "Madagasikara", "261", 9, 10],
  ["MW", "Malawi", "Malawi", "265", 9, 9],
  ["MY", "Malaysia", "Malaysia", "60", 9, 10],
  ["MV", "Maldives", "ދިވެހިރާއްޖެ", "960", 7, 7],
  ["ML", "Mali", "Mali", "223", 8, 8],
  ["MT", "Malta", "Malta", "356", 8, 8],
  ["MR", "Mauritania", "موريتانيا", "222", 8, 8],
  ["MU", "Mauritius", "Maurice", "230", 8, 8],
  ["MX", "Mexico", "México", "52", 10, 10],
  ["MD", "Moldova", "Moldova", "373", 8, 8],
  ["MC", "Monaco", "Monaco", "377", 8, 9],
  ["MN", "Mongolia", "Монгол", "976", 8, 8],
  ["ME", "Montenegro", "Crna Gora", "382", 8, 8],
  ["MA", "Morocco", "المغرب", "212", 9, 9],
  ["MZ", "Mozambique", "Moçambique", "258", 9, 9],
  ["MM", "Myanmar", "မြန်မာ", "95", 8, 10],
  ["NA", "Namibia", "Namibia", "264", 8, 9],
  ["NP", "Nepal", "नेपाल", "977", 10, 10],
  ["NL", "Netherlands", "Nederland", "31", 9, 9],
  ["NZ", "New Zealand", "New Zealand", "64", 8, 10],
  ["NI", "Nicaragua", "Nicaragua", "505", 8, 8],
  ["NE", "Niger", "Niger", "227", 8, 8],
  ["NG", "Nigeria", "Nigeria", "234", 8, 10],
  ["KP", "North Korea", "조선", "850", 8, 12],
  ["MK", "North Macedonia", "Македонија", "389", 8, 8],
  ["NO", "Norway", "Norge", "47", 8, 8],
  ["OM", "Oman", "عُمان", "968", 8, 8],
  ["PK", "Pakistan", "پاکستان", "92", 10, 10],
  ["PS", "Palestine", "فلسطين", "970", 9, 9],
  ["PA", "Panama", "Panamá", "507", 7, 8],
  ["PG", "Papua New Guinea", "Papua New Guinea", "675", 8, 8],
  ["PY", "Paraguay", "Paraguay", "595", 9, 9],
  ["PE", "Peru", "Perú", "51", 9, 9],
  ["PH", "Philippines", "Pilipinas", "63", 10, 10],
  ["PL", "Poland", "Polska", "48", 9, 9],
  ["PT", "Portugal", "Portugal", "351", 9, 9],
  ["QA", "Qatar", "قطر", "974", 8, 8],
  ["RO", "Romania", "România", "40", 9, 9],
  ["RU", "Russia", "Россия", "7", 10, 10],
  ["RW", "Rwanda", "Rwanda", "250", 9, 9],
  ["SA", "Saudi Arabia", "السعودية", "966", 9, 9],
  ["SN", "Senegal", "Sénégal", "221", 9, 9],
  ["RS", "Serbia", "Србија", "381", 8, 9],
  ["SL", "Sierra Leone", "Sierra Leone", "232", 8, 8],
  ["SG", "Singapore", "Singapore", "65", 8, 8],
  ["SK", "Slovakia", "Slovensko", "421", 9, 9],
  ["SI", "Slovenia", "Slovenija", "386", 8, 8],
  ["SO", "Somalia", "الصومال", "252", 8, 9],
  ["ZA", "South Africa", "South Africa", "27", 9, 9],
  ["KR", "South Korea", "대한민국", "82", 9, 10],
  ["SS", "South Sudan", "جنوب السودان", "211", 9, 9],
  ["ES", "Spain", "España", "34", 9, 9],
  ["LK", "Sri Lanka", "ශ්‍රී ලංකා", "94", 9, 9],
  ["SD", "Sudan", "السودان", "249", 9, 9],
  ["SE", "Sweden", "Sverige", "46", 9, 10],
  ["CH", "Switzerland", "Schweiz", "41", 9, 9],
  ["SY", "Syria", "سوريا", "963", 9, 9],
  ["TW", "Taiwan", "台灣", "886", 9, 9],
  ["TJ", "Tajikistan", "Тоҷикистон", "992", 9, 9],
  ["TZ", "Tanzania", "Tanzania", "255", 9, 9],
  ["TH", "Thailand", "ไทย", "66", 9, 9],
  ["TL", "Timor-Leste", "Timor-Leste", "670", 8, 8],
  ["TG", "Togo", "Togo", "228", 8, 8],
  ["TN", "Tunisia", "تونس", "216", 8, 8],
  ["TR", "Türkiye", "Türkiye", "90", 10, 10, "Turkey,Turkiye,تركيا,ترکیه"],
  ["TM", "Turkmenistan", "Türkmenistan", "993", 8, 8],
  ["UG", "Uganda", "Uganda", "256", 9, 9],
  ["UA", "Ukraine", "Україна", "380", 9, 9],
  ["AE", "United Arab Emirates", "الإمارات", "971", 9, 9],
  ["GB", "United Kingdom", "United Kingdom", "44", 10, 10, "Britain,UK,بریتانیا,انگلیس"],
  ["US", "United States", "United States", "1", 10, 10, "USA,America,آمریکا"],
  ["UY", "Uruguay", "Uruguay", "598", 8, 8],
  ["UZ", "Uzbekistan", "Oʻzbekiston", "998", 9, 9],
  ["VE", "Venezuela", "Venezuela", "58", 10, 10],
  ["VN", "Vietnam", "Việt Nam", "84", 9, 10],
  ["YE", "Yemen", "اليمن", "967", 9, 9],
  ["ZM", "Zambia", "Zambia", "260", 9, 9],
  ["ZW", "Zimbabwe", "Zimbabwe", "263", 9, 9],
];

const PATTERNS: Record<string, RegExp> = {
  IR: /^9\d{9}$/,
  TR: /^5\d{9}$/,
  US: /^[2-9]\d{9}$/,
  CA: /^[2-9]\d{9}$/,
  GB: /^7\d{9}$/,
  FR: /^[67]\d{8}$/,
  AF: /^7\d{8}$/,
};

export const DIAL_COUNTRIES: DialCountry[] = RAW.map(([iso, name, nativeName, dial, nsnMin, nsnMax, aliasStr]) => ({
  iso,
  name,
  nativeName,
  dial,
  nsnMin,
  nsnMax,
  aliases: aliasStr ? aliasStr.split(",") : [],
  nsnPattern: PATTERNS[iso],
}));

const BY_ISO = new Map(DIAL_COUNTRIES.map((c) => [c.iso, c]));

export function getDialCountry(iso: string | null | undefined): DialCountry | null {
  if (!iso) return null;
  return BY_ISO.get(iso.toUpperCase()) ?? null;
}

export function flagEmoji(iso: string): string {
  const code = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(127397 + code.charCodeAt(0), 127397 + code.charCodeAt(1));
}

export function searchDialCountries(query: string): DialCountry[] {
  const q = query.trim().toLowerCase().replace(/^\+/, "");
  if (!q) return DIAL_COUNTRIES;
  return DIAL_COUNTRIES.filter((c) => {
    const hay = [c.iso, c.name, c.nativeName, c.dial, ...c.aliases].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export const POPULAR_DIAL_ISOS = ["TR", "IR", "AF", "DE", "FR", "GB", "US", "AE", "SA", "IQ"] as const;
