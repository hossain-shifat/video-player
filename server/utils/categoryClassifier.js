"use strict";

// Ordered category → keyword list. Order matters: more specific categories
// are checked before generic ones (e.g. "kids cartoon" hits Cartoon/Kids
// before falling through to General Entertainment).
const CATEGORY_KEYWORDS = [
    ["Sports", ["sport", "sports", "espn", "football", "soccer", "cricket", "nba", "nfl", "nhl", "mlb", "golf", "tennis", "rugby", "boxing", "ufc", "mma", "racing", "f1", "motogp", "ole", "fox sports", "bein", "supersport"]],
    ["News", ["news", "noticias", "samachar", "khobor", "cnn", "bbc news", "al jazeera", "fox news", "msnbc", "press", "khabar"]],
    ["Movies", ["movie", "movies", "cinema", "film", "filme", "hollywood", "bollywood", "cineplex"]],
    ["TV Shows", ["series", "tv show", "drama series", "soap"]],
    ["Kids", ["kids", "children", "cartoon network", "nick", "nickelodeon", "disney junior", "baby", "toon", "preschool"]],
    ["Cartoon", ["cartoon", "anime", "toonami"]],
    ["Anime", ["anime", "animation japan", "crunchyroll"]],
    ["Music", ["music", "mtv", "vh1", "radio", "fm", "song", "hits", "concert"]],
    ["Documentary", ["documentary", "discovery", "national geographic", "nat geo", "history channel", "animal planet", "history"]],
    ["Lifestyle", ["lifestyle", "home and garden", "hgtv", "diy"]],
    ["Education", ["education", "learning", "school", "university", "edu"]],
    ["Religious", ["religious", "islamic", "quran", "church", "christian", "gospel", "catholic", "hindu", "buddhist", "faith"]],
    ["Business", ["business", "finance", "bloomberg", "cnbc", "stock", "economy", "market"]],
    ["Science", ["science", "tech", "technology", "space"]],
    ["Travel", ["travel", "tourism", "explore"]],
    ["Cooking", ["cooking", "food", "kitchen", "culinary", "chef", "recipe"]],
    ["Fashion", ["fashion", "style", "beauty"]],
    ["Comedy", ["comedy", "funny", "humor"]],
    ["Drama", ["drama"]],
    ["Action", ["action", "thriller"]],
    ["Local TV", ["local", "regional", "community"]],
    ["International TV", ["international", "world"]],
];

const RADIO_HINTS = ["radio", " fm", " am ", ".mp3", "icecast", "shoutcast"];

/**
 * Classifies a channel into a category using group-title + channel name.
 * Scans every keyword set and returns the first category whose keywords
 * appear in the combined text — order in CATEGORY_KEYWORDS acts as priority.
 * Falls back to "General" when nothing matches.
 */
function classifyCategory({ group, name, url }) {
    const haystack = `${group || ""} ${name || ""}`.toLowerCase();

    // Radio detection — checked first since it overrides genre-based category
    if (RADIO_HINTS.some((hint) => haystack.includes(hint)) || /\.(mp3|aac)(\?|$)/i.test(url || "")) {
        return "Radio";
    }

    for (const [category, keywords] of CATEGORY_KEYWORDS) {
        if (keywords.some((kw) => haystack.includes(kw))) return category;
    }

    return "General";
}

module.exports = { classifyCategory };
