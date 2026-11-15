// Food additives (by label name and E-number) and naturally occurring triggers.
// Shared by the scan API (to double-check Gemini) and the browser (to match against the user's list).

export type Additive = { name: string; group: string; e?: string };
export type NaturalTrigger = { trigger: string; foods: string[] };

// [label names / E-number pattern, common name, group, E-number]
const ADDITIVES: [RegExp, string, string, string?][] = [
  // Sulfites
  [/\b(sulph|sulf)ur dioxide\b|\bE ?220\b/i, "Sulfur dioxide", "Sulfites", "E220"],
  [/\bsodium (meta)?bisulph?f?ite\b|\bsodium metabisul(ph|f)ite\b|\bE ?22[23]\b/i, "Sodium metabisulfite", "Sulfites", "E223"],
  [/\bpotassium (meta)?bisul(ph|f)ite\b|\bE ?22[48]\b/i, "Potassium metabisulfite", "Sulfites", "E224"],
  [/\bsodium sul(ph|f)ite\b|\bE ?221\b/i, "Sodium sulfite", "Sulfites", "E221"],
  [/\b(sulph|sulf)ites?\b/i, "Sulfites", "Sulfites"],
  // Colorings
  [/\b(red ?(no\.? ?)?40|allura red( ac)?|fd&c red( no\.?)? ?40)\b|\bE ?129\b/i, "Red 40 (Allura Red)", "Colorings", "E129"],
  [/\b(yellow ?(no\.? ?)?5|tartrazine)\b|\bE ?102\b/i, "Yellow 5 (Tartrazine)", "Colorings", "E102"],
  [/\b(yellow ?(no\.? ?)?6|sunset yellow)\b|\bE ?110\b/i, "Yellow 6 (Sunset Yellow)", "Colorings", "E110"],
  [/\b(blue ?(no\.? ?)?1|brilliant blue)\b|\bE ?133\b/i, "Blue 1 (Brilliant Blue)", "Colorings", "E133"],
  [/\b(red ?(no\.? ?)?3|erythrosine)\b|\bE ?127\b/i, "Red 3 (Erythrosine)", "Colorings", "E127"],
  [/\b(carmine|cochineal|carminic acid)\b|\bE ?120\b/i, "Carmine", "Colorings", "E120"],
  [/\bannatto\b|\bE ?160b\b/i, "Annatto", "Colorings", "E160b"],
  [/\bcaramel colou?r\b|\bE ?150[a-d]?\b/i, "Caramel color", "Colorings", "E150"],
  [/\b(artificial colou?rs?|colou?r added)\b/i, "Artificial colors", "Colorings"],
  // Flavor enhancers
  [/\b(monosodium glutamate|msg)\b|\bE ?621\b/i, "MSG (monosodium glutamate)", "MSG", "E621"],
  [/\b(disodium (inosinate|guanylate)|ribonucleotides)\b|\bE ?6(27|31|35)\b/i, "Disodium inosinate/guanylate", "MSG", "E627"],
  [/\b(yeast extract|autolyzed yeast|hydrolyzed (vegetable|soy|corn) protein)\b/i, "Yeast extract / hydrolyzed protein", "MSG"],
  // Preservatives
  [/\bsodium benzoate\b|\bE ?211\b/i, "Sodium benzoate", "Preservatives", "E211"],
  [/\bbenzoic acid\b|\bE ?210\b/i, "Benzoic acid", "Preservatives", "E210"],
  [/\bpotassium sorbate\b|\bE ?202\b/i, "Potassium sorbate", "Preservatives", "E202"],
  [/\bsorbic acid\b|\bE ?200\b/i, "Sorbic acid", "Preservatives", "E200"],
  [/\b(calcium|sodium) propionate\b|\bE ?28[12]\b/i, "Propionate", "Preservatives", "E282"],
  [/\b(bha|butylated hydroxyanisole)\b|\bE ?320\b/i, "BHA", "Preservatives", "E320"],
  [/\b(bht|butylated hydroxytoluene)\b|\bE ?321\b/i, "BHT", "Preservatives", "E321"],
  [/\b(tbhq|tert-?butylhydroquinone)\b|\bE ?319\b/i, "TBHQ", "Preservatives", "E319"],
  [/\b(sodium|potassium) nitr[ia]te\b|\bE ?2(49|50|51|52)\b/i, "Nitrites / nitrates", "Nitrites", "E250"],
  // Sweeteners
  [/\baspartame\b|\bE ?951\b/i, "Aspartame", "Sweeteners", "E951"],
  [/\bsucralose\b|\bE ?955\b/i, "Sucralose", "Sweeteners", "E955"],
  [/\b(acesulfame k|acesulfame potassium)\b|\bE ?950\b/i, "Acesulfame K", "Sweeteners", "E950"],
  [/\bsaccharin\b|\bE ?954\b/i, "Saccharin", "Sweeteners", "E954"],
  [/\b(sorbitol|xylitol|maltitol|erythritol|mannitol)\b|\bE ?9(65|67|68)\b|\bE ?42[01]\b/i, "Sugar alcohols", "Sweeteners", "E420"],
  // Thickeners / emulsifiers people commonly react to
  [/\bcarrageenan\b|\bE ?407\b/i, "Carrageenan", "Thickeners", "E407"],
  [/\b(polysorbate ?80|polysorbate)\b|\bE ?433\b/i, "Polysorbate 80", "Emulsifiers", "E433"],
  [/\b(soy lecithin|sunflower lecithin|lecithin)\b|\bE ?322\b/i, "Lecithin", "Emulsifiers", "E322"],
];

// Foods naturally high in compounds some people react to by eating
const W = (words: string) => new RegExp(String.raw`\b(?:${words})(?:s|es)?\b`, "i");
const NATURAL: [string, RegExp][] = [
  ["histamine", W("aged cheese|parmesan|cheddar|gouda|blue cheese|brie|camembert|wine|beer|vinegar|sauerkraut|kimchi|kombucha|fermented \\w+|soy sauce|miso|tempeh|salami|pepperoni|bacon|cured meat|smoked fish|smoked salmon|anchovy|anchovie|sardine|mackerel|tuna|tomato|tomatoe|spinach|eggplant|aubergine|avocado|chocolate|cocoa")],
  ["nickel", W("chocolate|cocoa|cacao|peanut|almond|hazelnut|cashew|walnut|soy|soya|soybean|tofu|lentil|chickpea|bean|pea|oat|oatmeal|whole grain|whole wheat|buckwheat|sunflower seed|sesame seed|shellfish|shrimp")],
  ["salicylates", W("berry|berrie|strawberry|strawberrie|raspberry|raspberrie|blueberry|blueberrie|cherry|cherrie|grape|raisin|orange|pineapple|apricot|tomato|tomatoe|bell pepper|curry|paprika|cinnamon|cumin|turmeric|mint|peppermint|tea|honey|almond|olive|coconut|wintergreen")],
  ["tyramine", W("aged cheese|parmesan|cheddar|blue cheese|brie|salami|pepperoni|cured meat|smoked meat|soy sauce|miso|tempeh|sauerkraut|kimchi|draft beer|tap beer|red wine|yeast extract|marmite|vegemite|fava bean|broad bean")],
];

export function detectAdditives(texts: string[]): Additive[] {
  const all = texts.join(" | ");
  const out = new Map<string, Additive>();
  for (const [re, name, group, e] of ADDITIVES) if (re.test(all)) out.set(name, { name, group, e });
  // Drop the generic "Sulfites" entry when a specific sulfite was found
  if ([...out.values()].some(a => a.group === "Sulfites" && a.name !== "Sulfites")) out.delete("Sulfites");
  return [...out.values()];
}

export function detectNaturalTriggers(texts: string[]): NaturalTrigger[] {
  const out: NaturalTrigger[] = [];
  for (const [trigger, re] of NATURAL) {
    const foods = [...new Set(texts.flatMap(t => [...t.matchAll(new RegExp(re.source, "gi"))].map(m => m[0].toLowerCase())))].slice(0, 4);
    if (foods.length) out.push({ trigger, foods });
  }
  return out;
}

/** Does something on the user's list ("sulfites", "red dye 40", "e621", "histamine") match this additive/trigger? */
export function matchesUserList(list: string[], item: { name?: string; group?: string; e?: string; trigger?: string }) {
  const hay = [item.name, item.group, item.e, item.trigger].filter(Boolean).join(" ").toLowerCase().replace(/sulph/g, "sulf");
  return list.some(raw => {
    const a = raw.toLowerCase().trim().replace(/sulph/g, "sulf").replace(/s$/, "");
    if (!a) return false;
    if (hay.includes(a)) return true;
    // "red dye 40" ↔ "Red 40 (Allura Red)", "msg" ↔ "MSG (monosodium glutamate)"
    const words = a.split(/\s+/).filter(w => w !== "dye" && w !== "food");
    return words.length > 0 && words.every(w => hay.includes(w));
  });
}
