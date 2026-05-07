"use client";

import { FormEvent, useState } from "react";
import { generateSpellFromPrompt } from "@/game/ai/cogentSpellGenerator";
import { useGameStore } from "@/game/state/gameStore";

const examplePrompts = ["A massive flaming tornado that pulls enemies in", "A fast lightning spear that stuns", "A freezing storm field that slows everyone", "A shadow trap that breaks shields"];

export function PromptOverlay() {
  const promptOpen = useGameStore((state) => state.promptOpen);
  const selectedSlot = useGameStore((state) => state.selectedSlot);
  const setSelectedSlot = useGameStore((state) => state.setSelectedSlot);
  const saveGeneratedSpell = useGameStore((state) => state.saveGeneratedSpell);
  const exitSanctuary = useGameStore((state) => state.exitSanctuary);
  const [prompt, setPrompt] = useState(examplePrompts[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!promptOpen) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await generateSpellFromPrompt(prompt);
      saveGeneratedSpell(result.spell, result.source);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Spell generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="promptOverlay">
      <form className="promptPanel" onSubmit={handleSubmit}>
        <div className="promptEyebrow">Sanctuary State</div>
        <h1>Prompt a custom spell</h1>
        <p>The shield is up. Describe a spell and PromptCast will normalize it into a balanced match-local quick slot.</p>
        <label htmlFor="spellPrompt">Spell prompt</label>
        <textarea id="spellPrompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={240} autoFocus />
        <div className="slotPicker" aria-label="Spell slot">
          {[0, 1, 2, 3].map((slot) => (
            <button key={slot} type="button" className={slot === selectedSlot ? "selected" : ""} onClick={() => setSelectedSlot(slot)}>
              Slot {slot + 1}
            </button>
          ))}
        </div>
        <div className="examples">
          {examplePrompts.map((example) => (
            <button key={example} type="button" onClick={() => setPrompt(example)}>
              {example}
            </button>
          ))}
        </div>
        {error ? <div className="promptError">{error}</div> : null}
        <div className="promptActions">
          <button type="button" onClick={exitSanctuary} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy || prompt.trim().length < 3}>
            {busy ? "Generating..." : "Generate Spell"}
          </button>
        </div>
        <small>Set `NEXT_PUBLIC_COGENT_MODEL_URL` to a GGUF model URL to use CogentLM. Without it, the local keyword parser fallback is used.</small>
      </form>
    </div>
  );
}
