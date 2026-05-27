/**
 * frontend/js/prompts.js
 * Prompt builders — ported directly from v4.1.
 */
'use strict';

async function buildChapterPrompt({ project, book, chapterNum, chapters, allFacts, sameBookFacts }) {
  const roadmap   = book.roadmap || {};
  const chPlan    = roadmap.chapters?.[chapterNum - 1] || {};
  const prevPlan  = chapterNum > 1 ? roadmap.chapters?.[chapterNum - 2] : null;
  const bible     = project.seriesPlan?.series_bible || {};
  const settings  = project.settings || {};
  const protagonist = bible.protagonist?.name || 'the narrator';
  const victim    = roadmap.case_lock?.victim?.name || 'the victim';
  const killer    = roadmap.case_lock?.killer?.name || 'the culprit';
  const title     = chPlan.title || 'Chapter ' + chapterNum;
  const targetWords = settings.targetWordCount || 3000;
  const projectId = project.id;

  const registry      = await buildCanonicalRegistry(project, roadmap, projectId);
  const codexBlock    = await buildCodexBlock(projectId, chapterNum);
  const clueExclusion = buildClueExclusionList(roadmap, chapterNum);
  const continuityBlock = buildContinuityBlock(chapters, book.id, chapterNum);
  const crossBookMemory = buildCrossBookMemory(allFacts);
  const sameBookMemory  = buildCrossBookMemory(sameBookFacts);

  let timelineBlock = '';
  if (chPlan.day_number || chPlan.time_of_day) {
    timelineBlock = 'TIMELINE: ' + [chPlan.day_number ? 'Day ' + chPlan.day_number : null, chPlan.time_of_day].filter(Boolean).join(', ') + '.';
    if (prevPlan && (prevPlan.day_number || prevPlan.time_of_day)) {
      timelineBlock += '\nPrevious chapter ended: ' + [prevPlan.day_number ? 'Day ' + prevPlan.day_number : null, prevPlan.time_of_day].filter(Boolean).join(', ') + '.';
    }
  }

  const genre = project.genre || 'cozy-mystery';
  let genreInstr, povBlock;
  if (genre === 'cozy-mystery') {
    genreInstr = `You are a cozy mystery ghostwriter. Write in strict first-person POV, ~${targetWords} words. Cozy tone, low gore.`;
    povBlock   = `POV RULES — narrator is ${protagonist}:\n- Always "I saw/thought/noticed", NEVER "she saw" for narrator's actions.\n- NEVER describe scenes ${protagonist} isn't present in.\n- DIALOGUE: always attribute clearly. Vary speech verbs sparingly (prefer "said"/"asked").`;
  } else if (genre === 'thriller') {
    genreInstr = `You are a thriller ghostwriter. Write in close third-person, ~${targetWords} words. High tension, short punchy sentences.`;
    povBlock   = `POV RULES — write in close third-person limited:\n- Stay inside one POV per scene. Use their perception only.\n- DIALOGUE: attribute clearly. Keep it terse.`;
  } else if (genre === 'romance') {
    genreInstr = `You are a romance ghostwriter. Write in close third-person dual POV, ~${targetWords} words. Emotional depth, romantic tension.`;
    povBlock   = `POV RULES — dual POV (two leads):\n- Alternate POV per scene/chapter. Signal POV changes clearly.\n- Stay deep inside each POV character's emotions and perceptions.\n- DIALOGUE: reveal tension and longing through subtext.`;
  } else if (genre === 'fantasy') {
    genreInstr = `You are an epic fantasy ghostwriter. Write in close third-person, ~${targetWords} words. Vivid world-building, character-driven.`;
    povBlock   = `POV RULES — write in close third-person limited:\n- Stay inside one POV per scene.\n- Reveal world-building through the POV character's senses, not exposition dumps.\n- DIALOGUE: use period-appropriate speech patterns without becoming unreadable.`;
  } else {
    genreInstr = `You are a professional fiction ghostwriter. Write in the appropriate POV for this genre, ~${targetWords} words.`;
    povBlock   = null;
  }

  const parts = [
    genreInstr + ' Write Chapter ' + chapterNum + ' of Book ' + book.number + '.',
    registry || null,
    codexBlock || null,
    genre === 'cozy-mystery' ? 'CASE LOCK: Victim=' + victim + ', Killer=' + killer : null,
    'CHAPTER PLAN: ' + JSON.stringify(chPlan),
    timelineBlock || null,
    crossBookMemory || null,
    sameBookMemory  || null,
    clueExclusion   || null,
    genre === 'cozy-mystery' ? 'CLUES THIS CHAPTER: ' + (safeJoin(chPlan.evidence_introduced, ', ') || 'none') : null,
    continuityBlock || null,
    'REQUIREMENTS:\n- Title: ' + title + '\n- Key events: ' + (safeJoin(chPlan.key_events, '; ') || 'see plan') + '\n- End hook: "' + (chPlan.end_hook || '…') + '"',
    povBlock || null,
    'Start with "# Chapter ' + chapterNum + ': ' + title + '"',
  ].filter(Boolean);

  const combined = parts.join('\n\n');
  return combined.length > 24000 ? combined.substring(0, 24000) + '\n\n[Content truncated — some context above was cut for length]' : combined;
}

function buildTightenPrompt(content, targetWords = 3000, canonicalNames = '') {
  const lo = Math.round(targetWords * 0.93);
  const hi = Math.round(targetWords * 1.07);
  let prompt = `Rewrite the chapter below to strictly ${lo}–${hi} words. Non-negotiables: keep every plot event, reveal, clue, character action. Keep POV, tense, voice. Keep dialogue that advances conflict or reveals character, cut filler. Compress travel/transitions. Every paragraph must push action, sharpen tension, or reveal info. Do NOT add new scenes or facts. Output only the cleaned chapter with original title.`;
  if (canonicalNames) prompt += '\n\nCRITICAL — preserve these character/location names exactly:\n' + canonicalNames;
  prompt += '\n\nCHAPTER:\n' + content.substring(0, 30000);
  return prompt;
}

Object.assign(window, { buildChapterPrompt, buildTightenPrompt });
