# 23 — THE CHATBOX
The conversational way into the same agent. Not a separate assistant, not a help bot.
## 23.1 What it is
One input where a staff member asks for anything the product can do and gets either an answer grounded in their real org data or a draft awaiting approval. Reads the same tables, obeys the same RLS, produces the same approval artifacts. Nothing it produces sends, charges, or publishes — enforced at the database, not the prompt.
## 23.2 Capability catalogue
**Inbox intelligence:** who showed interest and not heard back · anyone asking about a program · what did I promise a named family · who went quiet after a trial · summarise the week. **Money:** who owes, how much outstanding · what did I make last month vs this · chase everyone > N weeks late · refund a named family · which program earns most. **Schedule:** my week · move an event and notify · cancel tomorrow for weather · when am I free · anyone double-booked. **Roster:** who is new · who has not signed a waiver · whose check/cert expires soon · everything on a named athlete · who is on which team. **Facilities:** find gym space on a day within N minutes · draft inquiries · what am I paying each facility. **Outreach — organisations only:** find leagues/schools/camps/clubs near me · draft introductions · who have I not followed up with. **Retention:** who has not booked in N weeks · draft re-engagement · whose package finishes soon. **Composition:** write to a named group about a thing · tell parents of an age group about an event · draft the monthly update. **Business:** how am I doing vs last period · am I losing clients · outstanding exposure.
## 23.3 Clarification, not guessing
Ask for exactly the missing field and nothing else. Never ask for what the system already holds (sport, location, age groups from programs).
## 23.4 Grounding rules
Every factual answer cites its source, clickable to rows. Never invents a number. Scoped by role via RLS (a coach cannot surface treasurer data because the query returns nothing). Sensitive fields excluded from every model context — assert in a test that inspects the assembled context. Bounded runs: max tokens, tool calls, wall clock; a run exceeding them is killed and recorded.
## 23.5 Anything that leaves the building is a draft
A request that would contact a person produces a draft in the rail. **Safety exception:** anything mentioning injury, abuse, or a child's welfare is never drafted; it escalates raw to director and owner with no AI summary.
## 23.6 The outreach constraint
Prospect organisations, never individuals. Public pages only, rate-limited, identified.
## 23.7 Failure behaviour
Cannot answer: say what is missing. Data does not exist: say which feature would produce it. Ambiguous: ask one question. Model outage: say so; the dashboard continues to work. Never a generic failure, never a confident wrong answer.
## 23.8 Acceptance
1 who owes money → correct sourced list · 2 go through my email and list interest → correct list · 3 facilities on a day → ranked candidates with drafted inquiries · 4 organisations to approach → organisations, never individuals · 5 cancel tomorrow → draft awaiting approval, nothing sent · 6 a coach asks a treasurer question → nothing, because RLS returned nothing.
