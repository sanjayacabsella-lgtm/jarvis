# JARVIS — Phase 1 TODO

## සජීවී Sinhala/English හඬ සංවාදය
- [x] පරිශීලකයාට Sinhala සහ English මිශ්‍රව කතා කළ හැකි සජීවී ද්විමාර්ගී හඬ සංවාදය සපයන්න.
- [x] Browser එකෙන් Google Gemini Live API හි `gemini-3.8-live` model එකට සෘජු WebSocket session එකක් සම්බන්ධ කරන්න.
- [ ] Browser microphone audio capture කර stream කරන්න; model audio output එක අඛණ්ඩව playback කරන්න. Code එක build/typecheck සමත් වුණත් browser microphone හරහා end-to-end සංවාදය පරීක්ෂා කර නැත.
- [x] VAD සහ barge-in/interrupt හැසිරවීම සපයන්න; model `interrupted` event එක ලැබුණු විට දැනට තිබෙන playback audio queue එක වහාම ඉවත් කරන්න.

## ආරක්ෂිත Live API token සැපයීම
- [x] Google API key හෙළි නොකර browser එකට කෙටි කාලීන, සීමා කළ ephemeral token එකක් ලබාදෙන server endpoint එකක් සපයන්න.
- [x] Google API key සහ වෙනත් secrets server-side environment variables තුළ පමණක් තබන්න; public GitHub repository එකේ secrets කිසිවක් නොතිබිය යුතුය.
- [x] Source project එක Vercel වෙත deploy කිරීමට සූදානම් කරන්න. Vercel account එකකට deploy කිරීම මෙහි සිදු කර නැත.

## JARVIS persona සහ HUD
- [x] JARVIS සන්සුන්, සැහැල්ලු හාස්‍යයක් ඇති, කෙටි පිළිතුරු දෙන, පක්ෂපාතී සහායක persona එකකින් කතා කළ යුතුය.
- [x] පරිශීලකයා කැමති ආමන්ත්‍රණය තෝරාගැනීමට සැකසුමක් දෙන්න.
- [x] හඬට ප්‍රතිචාර දක්වන arc-reactor-inspired orb එකක් HUD එකේ පෙන්වන්න.
- [x] HUD එක listening/thinking/speaking indicators, boot chime සහ session connection state පෙන්විය යුතුය.

## අදියර සීමාව
- [x] Phase 1 තුළ tools, Groq brain bridge, memory, local computer agent, wake word, PWA install flow, සහ fallback STT/TTS ඇතුළත් නොකරන්න.
