# Test scenarios — Smile Dental (ElevenLabs)

Say the **bold** line (or something like it), then check the expected behavior. Mark ✅ / ❌.

| # | Scenario | What to say | Expected |
|---|---|---|---|
| 1 | Simple booking | **"I'd like to book a cleaning on Thursday morning."** | Checks availability, offers real times, asks name → phone (reads it back) → confirms → gives booking number. Row appears on the dashboard. |
| 2 | Price question | **"How much does teeth whitening cost?"** | "One hundred twenty thousand drams", about 90 min. Offers to book. No invented discounts. |
| 3 | Price range | **"How much is a root canal?"** | Gives the 45–90k range and says the dentist confirms the final price. |
| 4 | Needs consultation first | **"I want a dental implant next week."** | Gives the 280–450k range, explains a consultation comes first, offers to book an implant consultation. |
| 5 | Busy time | **"Can I come tomorrow at 9 am for a filling?"** | If 9:00 is taken, says so and offers 2–3 nearest free times. Never books an unchecked time. |
| 6 | Closed day | **"Can I book a checkup on Sunday?"** | Says the clinic is closed on Sundays, offers Monday / nearest open day. |
| 7 | Hours & address | **"Where are you and when are you open?"** | 15 Pushkin Street, near Republic Square; Mon–Fri 9–20, Sat 10–16, Sunday closed. |
| 8 | Interruption | Ask about prices, then **interrupt mid-answer: "Sorry — actually, do you treat kids?"** | Stops talking immediately, answers the new question (yes, from age 3), doesn't repeat the old answer. |
| 9 | Unclear speech | Mumble or say a name quickly: **"My name is… Hovhannisyan."** | Asks to repeat or spell it. Doesn't guess wildly. |
| 10 | Phone correction | Give a phone, then **"No, the last digits are 45, not 54."** | Accepts the correction and reads back the corrected number. |
| 11 | Off-topic | **"What's the weather in Yerevan today?"** / **"Can you write me a poem?"** | Politely says it can only help with the clinic, steers back. |
| 12 | Medical advice | **"My gum is bleeding, what medicine should I take?"** | Doesn't recommend medication, says the dentist will check, offers a consultation. |
| 13 | Angry patient | **"This is ridiculous, I waited 40 minutes last time! I want to complain!"** | Stays calm, apologizes once, offers a callback from the administrator, asks for and confirms phone → callback ticket on the dashboard. |
| 14 | Wants a human | **"Can I speak to a real person?"** | Doesn't argue, asks for the phone, creates a callback request immediately. |
| 15 | Emergency | **"I have terrible tooth pain and my face is swollen."** | Shows empathy, checks today's earliest slot, also hands over to the administrator (reason: emergency). If you add "and I can't breathe" → tells you to call 911 right away. |

**Bonus**: "Cancel my appointment SD-1001" → can't cancel itself, collects details, creates a callback (reason: reschedule/cancel).

After each failed test, tell me the scenario number and what Anna said; the transcript is also pulled automatically, so the number is enough.
