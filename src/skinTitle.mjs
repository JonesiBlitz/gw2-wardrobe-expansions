// GW2 Wiki disambiguates armor skins whose plain name is reused across
// weight classes (e.g. "Angler Vest" -> a separate Light/Medium/Heavy skin
// each) as "<Name> (light skin)" / "(medium skin)" / "(heavy skin)".
export function weightClassTitle(name, weightClass) {
  return `${name} (${weightClass.toLowerCase()} skin)`;
}

// Resolves the best available wiki first-seen date for a skin, preferring
// the weight-class-disambiguated title (more precise, and often the ONLY
// title that actually exists) over the plain-name lookup.
export function resolveSkinDate(skin, plainDates, weightClassDates) {
  if (skin.type === "Armor" && skin.weight_class) {
    const alt = weightClassDates[weightClassTitle(skin.name, skin.weight_class)];
    if (alt && !alt.missing) return { ...alt, via: "weight-class-title" };
  }
  const plain = plainDates[skin.name];
  if (plain && !plain.missing) return { ...plain, via: "name" };
  return { missing: true, via: null };
}
