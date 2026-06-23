/**
 * Seed creator "Chioma" (@chiomawrites) with original content across every
 * Skimflow section: Articles, Agent Skills, two Books (long-form, written in the
 * emotionally-intense, time-loop "return by death" register popularised by
 * Tappei Nagatsuki — characters, world and prose are wholly original here, no
 * copyrighted text), and picture (Skimflow) photo-essays.
 *
 *   npm run db:seed:chioma          (from apps/web)
 *
 * Idempotent PER SLUG: re-running only inserts items that don't already exist,
 * so it's safe to run on top of an already-seeded database.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pool, queryOne } from "../lib/db.js";
import { createContent, createBook, getContentBySlug } from "../lib/store.js";
import { chunkContent } from "../lib/chunk-content.js";

function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv(".env.local");
loadEnv(".env");

const GATEWAY =
  process.env.CIRCLE_GATEWAY_ADDRESS ||
  process.env.GATEWAY_WALLET_ADDRESS ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

const CHIOMA = {
  email: "chioma@example.com",
  handle: "chiomawrites",
  name: "Chioma",
  wallet: "0xC410ma0000000000000000000000000000000001",
  avatar: "https://i.pravatar.cc/240?img=45",
  verified: true,
};

// ── Articles ─────────────────────────────────────────────────────────────────
const ARTICLES = [
  {
    slug: "writing-in-the-cracks",
    title: "Writing in the Cracks of a Long Commute",
    summary: "How I drafted a whole novel in the ninety minutes a day nobody wanted.",
    tags: "writing,craft,habit,routine",
    price: "0.03",
    body: [
      "For two years my only writing desk was a danfo seat with a cracked window and a stranger's elbow in my ribs. Ninety minutes there, ninety minutes back. I used to think real work needed a clean room and a quiet hour. The commute taught me that real work mostly needs you to stop negotiating with it.",
      "The trick was lowering the stakes until starting felt free. I never opened the document promising a chapter. I promised a sentence. One true sentence about how the morning smelled, how the conductor counted change, how a child slept standing up. A sentence is small enough to slip through a crack in a bad day.",
      "Momentum is sneaky. One sentence becomes three because three is easier than stopping. By the time the bus reached the bridge I had a paragraph I had not planned, and paragraphs you did not plan are the ones worth keeping. The plan protects the book from you; the surprise is the book protecting itself.",
      "I stopped waiting for the mood. Mood is a landlord who never shows up to fix anything. Habit is the friend who comes anyway, in the rain, and sits with you. The novel got finished not in a burst of inspiration but in four hundred small refusals to give the ninety minutes back.",
      "If you are waiting for the room and the hour, I am sorry, but they are not coming. Write in the cracks. The cracks are wider than they look.",
    ].join("\n\n"),
  },
  {
    slug: "why-i-stopped-chasing-virality",
    title: "Why I Stopped Chasing Virality",
    summary: "Ten thousand strangers for a day, or two hundred readers for a decade.",
    tags: "writing,internet,audience,craft",
    price: "0.03",
    body: [
      "The first time something I wrote went viral, I refreshed the numbers until my thumb ached. Ten thousand strangers in a day. I felt enormous. Then the wave passed, the way waves do, and the beach was exactly as empty as before. None of them stayed. None of them knew my name the following week.",
      "Virality optimises for the shape of a thing, not its weight. The sentences that travel are the ones light enough to be carried by people who never read past them. I was learning to write light. I was getting good at being forgotten quickly by many.",
      "So I made a quieter bet. I would write for the two hundred readers who would still be here in ten years, the ones who reply with a paragraph instead of a like. Two hundred is small enough to picture. You cannot write a love letter to a stadium.",
      "The strange thing is the work got better the moment it got smaller. When you write for people who stay, you can assume memory. You can plant something in chapter two and trust it will still be alive in chapter nine. Depth is a promise you can only make to people who are not leaving.",
      "I am not against the wave. I am only done living for it. Build for the people who come back. The internet rewards the loud, but reading has always belonged to the loyal.",
    ].join("\n\n"),
  },
  {
    slug: "the-second-draft-is-where-you-arrive",
    title: "The Second Draft Is Where You Actually Arrive",
    summary: "The first draft is just you telling yourself the story. The second is for the reader.",
    tags: "writing,editing,revision,craft",
    price: "0.03",
    body: [
      "Everyone romanticises the first draft. The blank page, the brave plunge, the blinking cursor. I get it. But the first draft is the least honest version of a book. It is you, alone, explaining the story to yourself so you finally understand what it is about. Nobody should have to read that. You barely should.",
      "The second draft is the real arrival. Now you know the ending, so you can go back and make the beginning deserve it. You can cut the three chapters where you were clearly stalling, the ones where characters drink tea and explain the plot to each other. You wrote those for you. Strike them for the reader.",
      "Revision is not punishment. It is the first time you write the book on purpose. Everything in draft one was a guess; everything in draft two is a decision. The difference between a guess and a decision is the whole craft.",
      "I keep one rule taped above my screen: cut what you are proud of if it does not serve the spine. The cleverest line I ever wrote is in a folder called graveyard, and the chapter it left behind is stronger without it. Pride is a heavy thing to carry through a book.",
      "Finish the first draft to find the story. Write the second to give it away.",
    ].join("\n\n"),
  },
];

// ── Agent Skills (writing-craft skills for AI writing agents) ────────────────
const AGENT_SKILLS = [
  {
    slug: "emotional-scene-beats",
    title: "Skill: Writing Emotional Scene Beats",
    summary: "A pay-per-block skill file teaching writing agents to build a scene that lands.",
    tags: "writing,agent-skills,craft,emotion",
    price: "0.04",
    body: [
      "## Skill: Anchor the body before the feeling\nWhen a character feels something, render the body first and name the emotion last (or never). Replace 'she was terrified' with the dry mouth, the loud pulse, the hand that will not unclench. Readers infer emotion from physiology faster than they accept a label. Flag any sentence that states a feeling without a physical anchor within two lines.",
      "## Skill: Withhold, then release\nBuild a beat by delaying the thing the reader wants. If a character must say 'I forgive you,' make them clean a cup, cross a room, look away — three small refusals — before the line. Tension is the distance between the want and the having. Never hand the emotional payload over on first request.",
      "## Skill: Cut the reaction shot\nAfter a blow lands, agents over-explain how the character feels about it. Trust the blow. Render the event, then cut hard to the next concrete action. One line of stunned silence beats a paragraph of inner narration. Flag any post-climax passage longer than the climax itself.",
      "## Skill: Let objects carry grief\nGrief is unbearable stated directly and devastating when displaced onto a thing — a cold plate set for someone who will not come, a shoe by the door. Give the emotion an object to live in. Flag abstract grief ('the loss was immense') and propose a concrete vessel to carry it instead.",
    ].join("\n\n"),
  },
  {
    slug: "revising-a-time-loop-narrative",
    title: "Skill: Revising a Time-Loop Narrative",
    summary: "A pay-per-block skill file for agents editing repeating-timeline stories.",
    tags: "writing,agent-skills,structure,timeloop",
    price: "0.05",
    body: [
      "## Skill: Vary the entry, never the anchor\nIn a loop story the reset point must stay identical (same room, same bell, same first line) so the reader feels the cage, but the character's ENTRY into the scene must change every iteration — new knowledge, new dread, new shortcuts. Flag loops where the prose repeats verbatim without the protagonist's perception shifting.",
      "## Skill: Escalate the cost of knowing\nEach loop the character learns more, so each loop must hurt more. Information without rising cost flattens into a puzzle. Ensure every gained fact is paid for in trust, sanity, or a relationship. Flag any iteration where the protagonist gains knowledge for free.",
      "## Skill: Hide the rules in suffering, not exposition\nNever let a character explain the loop's mechanics in dialogue. Reveal each rule the hard way — the character discovers a boundary by breaking themselves against it. Flag any passage where loop rules are stated rather than survived.",
      "## Skill: Earn the final iteration\nThe last loop should resolve using only knowledge the reader watched the character pay for. No new power, no rescue from offstage. Audit the climax: every tool used must have a visible price earlier in the story. Flag deus ex machina resolutions and trace each winning move back to the loop that bought it.",
    ].join("\n\n"),
  },
];

// ── Books (long-form, original; Tappei-Nagatsuki-style emotional time-loop) ──
const BOOKS = [
  {
    slug: "ashes-before-dawn",
    title: "Ashes Before Dawn",
    description:
      "A courier in a walled town dies and wakes at the dawn bell, doomed to relive the morning the plague-cart comes. Each death teaches him one more thing — and takes one more thing he cannot get back.",
    tags: "fiction,dark-fantasy,timeloop,book",
    price: "0.04",
    cover: "https://picsum.photos/seed/ashes-before-dawn/800/1200",
    chapters: [
      {
        title: "Chapter One — The Bell That Won't Stay Rung",
        pages: [
          "The dawn bell rang and Reki woke with his cheek against cold stone, the taste of copper in his mouth, and the absolute certainty that he had already died today.\n\nHe did not know how he knew. He only knew the way you know your own name when someone shouts it across a crowd. His hands were whole. His chest, which he distinctly remembered being opened, was closed and rising. The market square of Velgrad lay around him exactly as it always did at the sixth bell: the fishwives unstacking their crates, the lamplighter killing the last flame, the smell of wet rope and frying dough. Ordinary. Unbearably ordinary.\n\n'You alright, courier?' The bread-seller, Oma, frowned down at him. She had asked him this before. He was sure of it. He had heard those exact words, in that exact order, with that exact crack on the word courier.\n\n'What day is it,' Reki said. It was not a question. It was a hand reaching for a wall in the dark.\n\n'Same day it was yesterday, more or less.' She laughed. 'Marketday. You sleep here?'\n\nHe had not slept here. He had gone home. He had eaten supper. He had — he was almost certain — been killed. And yet here was the morning, served up again, still warm.",
          "He told himself it was a dream the way a drowning man tells himself the water is shallow. He went about the round. Letters to the upper district, a parcel to the apothecary, a sealed writ for the gate captain. His feet knew the route so well he could have run it blind, and as he ran a second memory ran underneath the first, like a voice speaking just behind his own.\n\nAt the apothecary the second memory said: she will ask about her son. The apothecary looked up and asked about her son. At the gate the second memory said: the captain drops his seal and curses. The captain dropped his seal and cursed. Reki stood very still in the cold and felt the morning fit itself over a shape he had already lived.\n\nBy the ninth bell the dread had a flavour. By the tenth it had a sound. And at the eleventh bell, when the southern gate groaned open and a low cart rolled in under a grey tarp, drawn by a horse with its head down and a driver with a cloth over his face, Reki understood the shape his day was poured into.\n\nHe had seen that cart before. He had died near that cart before. He did not yet know which of those facts had caused the other.",
          "The cart stopped in the middle of the square and the driver did not get down. People drifted toward it the way people drift toward anything that has stopped where things are supposed to move. Oma went. The lamplighter went. A child went, because children always go.\n\nReki's legs carried him forward against every screaming instinct, because the second memory, the one that ran behind his own, was no longer narrating. It had gone silent the way a room goes silent before a roof comes down. Whatever happened next, he had not survived long enough last time to remember it.\n\n'Don't,' he said, to no one, to everyone. 'Don't touch the tarp.'\n\nThe driver turned his covered face toward the courier as if he had been waiting, across the whole long machinery of the morning, for exactly that voice to speak exactly those words. Slowly, almost gently, a gloved hand rose to the edge of the grey cloth.\n\nReki ran. Not away. Toward. He would understand later — much later, after the counting had begun — that running toward the thing that kills you is its own kind of madness, and that he had already chosen it before he knew there would be a price.",
        ],
      },
      {
        title: "Chapter Two — Counting the Ways I've Died",
        pages: [
          "The dawn bell rang and Reki woke with his cheek against cold stone, and this time he screamed.\n\nIt was not a brave sound. He wanted to be the kind of person whose first response to horror was a clenched jaw and a plan. He was not that person. He was a courier with thin arms and a scream that frightened the fishwives, and Oma came and asked if he was alright, courier, and he laughed until it turned into something with no name.\n\nTwo, he thought, when the laughing let him go. This is the second time. He pressed the number into himself like a thumb into clay, because he had already learned the morning's cruellest rule: it kept the day and gave him back his body, but it kept nothing of what he carried unless he carried it hard enough to hurt. Knowledge cost. Everything here cost. He just hadn't been billed yet.",
          "So he counted. It was the only science he had.\n\nThe third time, he kept the child away from the cart and the child lived an hour longer and died anyway, and Reki learned that saving one thing is not the same as saving the day. The fourth time, he warned the gate captain, who had him arrested for spreading plague-panic, and Reki died in a cell, which taught him that being right is worthless if no one will stand close enough to hear you. The fifth time he said nothing to anyone and simply watched, and that was the worst death of all, because nothing teaches you the shape of your own cowardice like surviving an extra ten minutes by it.\n\nEach dawn he woke with the count one higher and his hands a little less his own. He was becoming a thing the morning was sculpting, one death at a time, and somewhere around the ninth he stopped being able to remember the colour of his mother's door without first remembering how he had died the time he tried to run home to it.",
          "Here is what the counting taught him, in the end, though it taught him slowly and made him pay for every lesson in a coin he could not see being spent.\n\nThe cart was not the enemy. The cart was a question. The driver was not death; the driver was a door, and the tarp was the handle, and every loop that ended with Reki reaching for that handle ended the same because he had been asking the wrong thing. He had been asking how do I stop this. The morning did not answer that question. It had never once answered that question.\n\nThe question it answered — the only question it answered — was who are you willing to become to learn the truth, and how many times can you die before the answer stops being you.\n\nReki woke at the dawn bell. His cheek was against cold stone. The count was higher than he would ever tell another living soul. And for the first time in more mornings than he could bear to number, he did not scream. He stood. He brushed the ash from his sleeves. And he walked toward the southern gate to meet the cart on purpose, carrying everything the dying had taught him, ready at last to ask it the right thing.",
        ],
      },
    ],
  },
  {
    slug: "the-girl-who-drowned-on-tuesdays",
    title: "The Girl Who Drowned on Tuesdays",
    description:
      "Every time Mio fails to pull her little sister from the flooded canal, the week folds back to Tuesday morning and she gets to try again. The water remembers. So, eventually, does she.",
    tags: "fiction,drama,timeloop,book",
    price: "0.04",
    cover: "https://picsum.photos/seed/drowned-on-tuesdays/800/1200",
    chapters: [
      {
        title: "Chapter One — Tuesday, Again",
        pages: [
          "It is always raining when Mio wakes, and it is always Tuesday, and the clock on the wall always says ten past six, and downstairs her little sister Aki is always singing the wrong words to a song about the moon.\n\nThe first time, Mio did not know it was the first time. That is the thing nobody tells you about the worst day of your life: you walk into it like any other, with your shoes untied and your mind on something small. She had been thinking about a boy. She had been thinking about whether the rain would ruin her one good coat. She had not been thinking about the canal at the end of the lane, swollen brown and fast, with the railing the city had been promising to fix since before either girl was born.\n\nAki was seven and could not swim and believed, with the whole bright engine of her heart, that her big sister could fix anything. By the end of that first Tuesday, Mio had learned exactly how wrong a seven-year-old can be, and how patiently the world will let you find out.",
          "The second Tuesday arrived without ceremony. Mio opened her eyes to the rain and the clock and the wrong words about the moon, and she lay there for a long moment thinking she had dreamed something terrible, the kind of dream that leaves a bruise you keep pressing.\n\nThen Aki sang the line about the silver boat — she always got the silver boat wrong, it was a silver road in the real song — and Mio was out of bed and down the stairs before she had decided to move, because some knowledge does not wait for you to believe it. Aki blinked up from her breakfast, spoon halfway to her mouth.\n\n'You're crying,' Aki said, delighted and concerned in the way only small children manage at once. 'Why are you crying, it's just Tuesday.'\n\nMio did not have an answer that a seven-year-old could hold. She knelt and gripped her sister's shoulders too hard and said, 'We are not going near the canal today. Not for anything. Promise me.' And Aki, who would have promised her the moon and the silver road too, promised. And it did not matter. It would take Mio four more Tuesdays to understand that a promise is not a railing, and that the water did not need the canal to take what it had decided to take.",
          "She kept the count in a notebook she knew would not survive the reset, writing it anyway, because the writing was for the girl doing it and not for any future that would get to read it. Tuesday three. Tuesday four. The handwriting got worse. The list of things she had tried got longer and the list of things that worked stayed empty in a way that began to feel less like bad luck and more like a sentence handed down.\n\nKeep her home: the pipe bursts and the house floods to the second step. Leave town early: the bus fords the low road and the low road is not low today. Tell their mother: their mother, exhausted and frightened, takes Mio to a doctor, and the appointment runs long, and by the time they are done the rain has done what rain does to a city built below its own rivers.\n\nThe water, Mio began to understand, was not in the canal. The canal was only where she kept meeting it. The water was in the Tuesday itself, threaded through every hour of it, and if she wanted to save her sister she would have to stop fighting the place and start understanding the day.",
        ],
      },
      {
        title: "Chapter Two — What the Water Keeps",
        pages: [
          "Somewhere in the double digits, Mio stopped trying to save Aki and started trying to understand her.\n\nIt sounds like surrender. It was the opposite. She had spent ten Tuesdays treating her sister as a problem to be solved — kept indoors, kept dry, kept away — and ten Tuesdays the water had reached past her guarding hands as if they were not there. So she changed the question. Not how do I keep Aki from the canal. Instead: why does Aki go.\n\nAnd she watched. She let a Tuesday run almost to the end without intervening, which was the bravest and most monstrous thing she had ever done, standing back to study the worst moment of her life as though it were a tide chart. And she saw it. At a quarter to four, every single Tuesday, Aki slipped out toward the lane — not from mischief, not from disobedience, but because she had seen a cat, a thin grey cat with a torn ear, crouched on the wrong side of the broken railing, crying in the rain. Aki went to the canal because Aki could not bear to leave a small frightened thing alone in the water. She went for the same reason Mio kept coming back.",
          "Knowing the reason did not make the next Tuesdays easier. It made them heavier, the way a true thing is always heavier than a false comfort.\n\nBecause now Mio could not pretend her sister was being careless. Aki was being kind, exactly as kind as their mother had raised them both to be, and the day was using that kindness as a hook. To save Aki, Mio could not simply restrain her. She would have to honour the thing in Aki that the water was exploiting, and find a way for her sister to be brave and gentle and seven years old and also, somehow, still alive at ten past six the next morning.\n\nSo on a Tuesday whose number she had stopped saying aloud, Mio woke to the rain and the clock and the wrong words about the moon, and she did not run downstairs in terror. She went down quietly. She made breakfast. And at half past three, before the cat, before the railing, before the quarter-to-four that had ended her a dozen ways, she took her sister's hand and said: 'There's a grey cat by the canal with a hurt ear. I know. I'm going to help it. But you have to do exactly what I say, because I have done this before, and I am not going to lose you to a thing that just wanted us to be kind.'",
          "Aki looked up at her with the whole bright engine of her heart and did not ask how Mio knew about the cat. Small children accept the impossible far more gracefully than the people who raise them; it is one of the few mercies built into being seven.\n\n'Okay,' Aki said simply. 'But we're saving the cat.'\n\n'We're saving the cat,' Mio agreed, and her voice did not shake, though every Tuesday she had ever drowned in was standing in the room with her, listening.\n\nShe did not know if it would work. That is the truth the loop had carved into her over all those folded weeks: you do not get certainty before you act, you only get it after, and sometimes not even then. She knew the day now. She knew the cat, the railing, the quarter-to-four, the exact brown speed of the water. She had paid for that knowledge one Tuesday at a time, in the only currency the morning accepted, and she had nothing left to spend and nothing left to fear.\n\nThe rain came down. The clock ticked toward a quarter to four. And Mio walked her sister out into the worst day of her life for what she had decided, with everything she had become, would be the last time — to save the cat, to save Aki, and to find out at last whether a week could be taught to end on a Wednesday.",
        ],
      },
    ],
  },
];

// ── Picture (Skimflow) photo-essays ──────────────────────────────────────────
const PICTURES = [
  {
    slug: "lagos-at-golden-hour",
    title: "Lagos at Golden Hour",
    summary: "A short photo-essay: the city in the last warm light before the lamps win.",
    tags: "photography,lagos,skimflow,street",
    price: "0.02",
    images: [
      { url: "https://picsum.photos/seed/lagos-1/1200/800", caption: "The bridge, the moment the traffic turns to gold." },
      { url: "https://picsum.photos/seed/lagos-2/1200/800", caption: "A mango seller counting the day's last coins." },
      { url: "https://picsum.photos/seed/lagos-3/1200/800", caption: "Rooftops, antennae, and a sky that refuses to hurry." },
      { url: "https://picsum.photos/seed/lagos-4/1200/800", caption: "The first lamp flickers on. Golden hour concedes." },
    ],
  },
  {
    slug: "markets-and-mothers",
    title: "Markets and Mothers",
    summary: "Hands, scales, and small kindnesses, photographed across one market morning.",
    tags: "photography,market,skimflow,portrait",
    price: "0.02",
    images: [
      { url: "https://picsum.photos/seed/market-1/1200/800", caption: "Tomatoes stacked into impossible red pyramids." },
      { url: "https://picsum.photos/seed/market-2/1200/800", caption: "A mother's hand on a brass scale, deciding fairness." },
      { url: "https://picsum.photos/seed/market-3/1200/800", caption: "Two traders sharing tea between customers." },
      { url: "https://picsum.photos/seed/market-4/1200/800", caption: "A child asleep among the baskets, trusted to the noise." },
    ],
  },
];

async function upsertChioma(): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (email, name, display_name, handle, wallet_address, avatar, role, verified)
       VALUES ($1,$2,$2,$3,$4,$5,'creator',$6)
     ON CONFLICT (email) DO UPDATE
       SET wallet_address = EXCLUDED.wallet_address,
           avatar = EXCLUDED.avatar,
           handle = EXCLUDED.handle,
           verified = EXCLUDED.verified
     RETURNING id`,
    [CHIOMA.email, CHIOMA.name, CHIOMA.handle, CHIOMA.wallet, CHIOMA.avatar, CHIOMA.verified]
  );
  return row!.id;
}

async function main() {
  const creatorId = await upsertChioma();
  console.log(`✓ creator @${CHIOMA.handle} (${creatorId})`);

  let created = 0;
  let skipped = 0;
  const skip = async (slug: string) => {
    if (await getContentBySlug(slug)) {
      console.log(`  · skip (exists) ${slug}`);
      skipped++;
      return true;
    }
    return false;
  };

  for (const a of ARTICLES) {
    if (await skip(a.slug)) continue;
    const chunks = chunkContent({ content: a.body, format: "article" });
    await createContent({
      creatorId,
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      tags: a.tags,
      contentType: "article",
      body: a.body,
      pricePerBlock: a.price,
      gatewayAddress: GATEWAY,
      chunks: chunks.map((c, i) => ({ text: c.text, isFree: i === 0 })),
      firstBlockIndex: 0,
      status: "published",
    });
    console.log(`  + article "${a.title}" (${chunks.length - 1} payable @ ${a.price})`);
    created++;
  }

  for (const s of AGENT_SKILLS) {
    if (await skip(s.slug)) continue;
    const chunks = chunkContent({ content: s.body, format: "markdown" });
    await createContent({
      creatorId,
      slug: s.slug,
      title: s.title,
      summary: s.summary,
      tags: s.tags,
      contentType: "agent-skills",
      body: s.body,
      pricePerBlock: s.price,
      gatewayAddress: GATEWAY,
      chunks: chunks.map((c) => ({ text: c.text, isFree: false })),
      firstBlockIndex: 1,
      status: "published",
    });
    console.log(`  + agent-skills "${s.title}" (${chunks.length} blocks @ ${s.price})`);
    created++;
  }

  for (const b of BOOKS) {
    if (await skip(b.slug)) continue;
    const pages = b.chapters.reduce((n, ch) => n + ch.pages.length, 0);
    await createBook({
      creatorId,
      slug: b.slug,
      title: b.title,
      description: b.description,
      coverImageUrl: b.cover,
      pricePerBlock: b.price,
      gatewayAddress: GATEWAY,
      tags: b.tags,
      status: "published",
      chapters: b.chapters.map((ch) => ({ title: ch.title, pages: ch.pages })),
    });
    console.log(`  + book "${b.title}" (${b.chapters.length} chapters, ${pages} pages @ ${b.price})`);
    created++;
  }

  for (const p of PICTURES) {
    if (await skip(p.slug)) continue;
    await createContent({
      creatorId,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      tags: p.tags,
      contentType: "picture",
      body: "",
      pricePerBlock: p.price,
      gatewayAddress: GATEWAY,
      chunks: p.images.map((im, i) => ({ text: im.url, isFree: i === 0, imageUrl: im.url, caption: im.caption })),
      firstBlockIndex: 0,
      status: "published",
    });
    console.log(`  + picture "${p.title}" (${p.images.length} images @ ${p.price})`);
    created++;
  }

  console.log(`\n✓ Chioma seed complete — ${created} new item(s), ${skipped} already present.`);
  await pool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error("Chioma seed failed:", e?.message ?? e);
  process.exit(1);
});
