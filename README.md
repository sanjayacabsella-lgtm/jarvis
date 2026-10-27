# JARVIS — පළමු අදියර

මෙය Google Gemini Live API මඟින් ක්‍රියාකරන, සජීවී ද්විමාර්ගී හඬ සංවාදයක් සහිත JARVIS ආභාසිත වෙබ් යෙදුමකි. බ්‍රවුසරය සීමා කළ කෙටි කාලීන token එකකින් සෘජුව සම්බන්ධ වේ; API key එක server පැත්තේ පමණක් පවතී.

## ඔබේ පරිගණකයේ ධාවනය

Node.js 22 සහ `package.json` තුළ නියම කර ඇති pnpm 11.25.0 භාවිත කරන්න. `.env.example` පිටපත් කර `.env.local` සාදා, එහි `GEMINI_API_KEY` සඳහා Google Gemini API key එක දමන්න. ඉන්පසු:

```bash
pnpm install
pnpm dev
```

නව බ්‍රවුසරයකින් `http://localhost:3000` විවෘත කර මයික්‍රෆෝනයට අවසර දෙන්න. API key එක කියවන්නේ `app/api/live-token/route.ts` පමණි. එය `NEXT_PUBLIC_` නමින් ආරම්භ වන අගයක් බවට පත් නොකරන්න; `.env.local` GitHub වෙත යවන්න එපා.

## Vercel වෙත යෙදවීම

GitHub ගබඩාව Vercel වෙත සම්බන්ධ කර ඇති ව්‍යාපෘතියේ server-side Environment Variables යටතේ `GEMINI_API_KEY` එක් කරන්න. `NEXT_PUBLIC_` භාවිත නොකරන්න. GitHub සම්බන්ධතාවයෙන් ස්වයංක්‍රීය යෙදවීම සක්‍රිය නම් `main` ශාඛාවට යවන වෙනස්කම් එහි නව යෙදවීමක් ආරම්භ කරයි; එසේ නොමැති නම් Vercel වෙතින් නැවත යෙදවීම අරඹන්න.

Token endpoint එක ආකෘතිය සහ හඬ සැසිය සීමා කරයි, එක් වරක් පමණක් භාවිත කළ හැකි token නිකුත් කරයි, එකම මූලාශ්‍රයෙන් එන ඉල්ලීම් පරීක්ෂා කරයි, සහ `x-real-ip` මත මිනිත්තුවකට ඉල්ලීම් හයක් දක්වා තාවකාලික සීමාවක් යොදයි. මෙම සීමාව server instance එකේ මතකය තුළ පමණක් පවතින නිසා Vercel instances අතර බෙදාගැනෙන්නේ නැත; එකම මූලාශ්‍ර පරීක්ෂාව පමණක් පරිශීලක හඳුනාගැනීමක් නොවේ. පුළුල් ලෙස බෙදාගැනීමට පෙර ස්ථිර සීමාකරණයක් සහ token නිකුත් කිරීමේ පාලනයක් එක් කරන්න. `x-real-ip` අගය විශ්වාසදායක ingress එකකින් සකස් වන බවත් තහවුරු කරන්න.

## හඬ සහ තිරයේ තත්ත්ව

JARVIS පරිශීලකයා කතා කරන භාෂාවෙන්—සිංහලෙන් හෝ ඉංග්‍රීසියෙන්—පිළිතුරු දෙයි. සාමාන්‍ය ප්‍රශ්නයකට සාමාන්‍යයෙන් සම්පූර්ණ වාක්‍ය 2–5කින්, ප්‍රයෝජනවත් සන්දර්භයක් සහිතව පිළිතුරු දීමට උපදෙස් දී ඇත; සංකීර්ණ ඉල්ලීම්වලදී අවශ්‍ය තරම් පැහැදිලි කරයි. පිළිතුරට පෙර දිගු හැඳින්වීමක් නොකියන ලෙසද සකසා ඇත. නිහඬ කාලය 450 ms දක්වා අඩු කිරීමෙන් කතා අවසන් වූ පසු පිළිතුර ඉක්මනින් ආරම්භ කිරීමට උපකාරී වේ; සැබෑ ප්‍රමාදය ජාලය සහ Google සේවාවේ ප්‍රතිචාර කාලය මතද රඳා පවතී.

තිරයේ “ඔබට සවන් දෙමින්”, “පිළිතුර සකස් කරමින්” සහ “කතා කරමින්” යන තත්ත්ව, හඬට ප්‍රතිචාර දක්වන ආලෝක කේන්ද්‍රය, සහ අවසන් හඬ පිටපත් දෙක පෙන්වයි. පිටපත් වත්මන් පිටුවේ මතකයේ පමණක් තබා සැසිය නවත්වන විට ඉවත් කරයි; යෙදුම ඒවා ගබඩා නොකරයි. ඔබ කැමති ආමන්ත්‍රණය බ්‍රවුසරයේ `localStorage` තුළ තබා token ඉල්ලීමේදී පමණක් යවයි.

## පළමු අදියරේ සීමා

මෙහි tools, Groq bridge, memory, පරිගණක පාලනය, wake word, PWA ස්ථාපනය, fallback STT/TTS හෝ සැසි නැවත ඇරඹීම ඇතුළත් නොවේ. සජීවී හඬ Google සේවාව වෙත යැවෙන නිසා එහි වත්මන් පෞද්ගලිකත්ව කොන්දේසි සහ ඔබේ ගිණුමේ quota සීමා පරීක්ෂා කරන්න. සජීවී හඬ සැසියට කාල සීමා ඇත; මෙම අදියරේදී සැසිය ස්වයංක්‍රීයව නැවත සම්බන්ධ නොවේ.

## නිල ලේඛන

- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [Gemini Live — `gemini-3.8-live`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [කෙටි කාලීන token](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)
- [හඬ හඳුනාගැනීම, VAD සහ භාෂා](https://ai.google.dev/gemini-api/docs/live-guide)
- [සැසි කළමනාකරණය](https://ai.google.dev/gemini-api/docs/live-session)


## Voice selection

The interface is entirely in English. Choose **Male — Achird** or **Female — Aoede** from the assistant voice selector. The selection is saved in this browser and applied to both the server-issued session token constraints and the live Gemini session. The assistant can still converse in Sinhala or English, and transcripts follow the spoken language.
