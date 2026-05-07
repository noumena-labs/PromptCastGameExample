"use client";

import { FormEvent, useState } from "react";
import { generateSpellFromPrompt } from "@/game/ai/cogentSpellGenerator";
import { useGameStore } from "@/game/state/gameStore";
import type { GeneratedSpell } from "@/game/types";

const examplePrompts = [
  "A massive flaming tornado that pulls enemies in",
  "A fast lightning spear that stuns",
  "A freezing storm field that slows everyone",
  "A shadow trap that breaks shields",
];

export function PromptOverlay() {
  const promptOpen = useGameStore((state) => state.promptOpen);
  const selectedSlot = useGameStore((state) => state.selectedSlot);
  const setSelectedSlot = useGameStore((state) => state.setSelectedSlot);
  const saveGeneratedSpell = useGameStore((state) => state.saveGeneratedSpell);
  const exitSanctuary = useGameStore((state) => state.exitSanctuary);

  const [prompt, setPrompt] = useState(examplePrompts[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratedSpell | null>(null);
  const [previewSource, setPreviewSource] = useState<"cogentlm" | "fallback" | null>(null);

  if (!promptOpen) return null;

  const handleDivine = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await generateSpellFromPrompt(prompt);
      setPreview(result.spell);
      setPreviewSource(result.source);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Spell generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleSeal = () => {
    if (!preview || !previewSource) return;
    saveGeneratedSpell(preview, previewSource);
    setPreview(null);
    setPreviewSource(null);
  };

  return (
    <div className="promptOverlay">
      <div className="spellbook" role="dialog" aria-modal="true" aria-label="Prompt a custom spell">
        {/* LEFT PAGE — quill */}
        <form className="spellbookPage" onSubmit={handleDivine}>
          <div className="spellbookEyebrow">Sanctuary &middot; Quill &amp; Ink</div>
          <h1 className="spellbookTitle">Inscribe a Spell</h1>
          <p className="spellbookCopy">
            The shield is up. Whisper your intent into the page &mdash; the tome will divine a balanced spell and bind it to a runestone.
          </p>

          <label htmlFor="spellPrompt">Incantation</label>
          <textarea
            id="spellPrompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={240}
            autoFocus
          />

          <label>Bind to Runestone</label>
          <div className="slotPicker" aria-label="Spell slot">
            {[0, 1, 2, 3].map((slot) => (
              <button
                key={slot}
                type="button"
                className={slot === selectedSlot ? "selected" : ""}
                onClick={() => setSelectedSlot(slot)}
              >
                {["I", "II", "III", "IV"][slot]}
              </button>
            ))}
          </div>

          <label>Sample Incantations</label>
          <div className="examples">
            {examplePrompts.map((example) => (
              <button key={example} type="button" onClick={() => setPrompt(example)}>
                &ldquo;{example}&rdquo;
              </button>
            ))}
          </div>

          {error ? <div className="promptError">{error}</div> : null}

          <div className="promptActions">
            <button type="button" className="sealButton ghost" onClick={exitSanctuary} disabled={busy}>
              Close Tome
            </button>
            <button type="submit" className="sealButton" disabled={busy || prompt.trim().length < 3}>
              {busy ? "Divining\u2026" : "Divine Spell"}
            </button>
          </div>

          <small className="promptFootnote">
            Set <code>NEXT_PUBLIC_COGENT_MODEL_URL</code> to a GGUF model URL to use CogentLM. Otherwise the local keyword parser is used.
          </small>
        </form>

        {/* RIGHT PAGE — preview */}
        <aside className="spellbookPage">
          <div className="spellbookEyebrow">Divined Spell</div>
          <h2 className="spellbookTitle">{preview ? preview.name : "Awaiting Inscription"}</h2>

          {preview ? (
            <SpellPreviewCard spell={preview} source={previewSource} />
          ) : (
            <p className="spellbookCopy">
              Once you divine a spell, its glyphs will appear here. Review the shape, element, and cost &mdash; then press the wax seal to bind it to runestone {selectedSlot + 1}.
            </p>
          )}

          <div className="promptActions">
            {preview ? (
              <button type="button" className="sealButton ghost" onClick={() => setPreview(null)} disabled={busy}>
                Discard
              </button>
            ) : null}
            <button
              type="button"
              className="sealButton"
              onClick={handleSeal}
              disabled={busy || !preview}
              aria-label={`Seal spell to runestone ${selectedSlot + 1}`}
            >
              Seal to Runestone {["I", "II", "III", "IV"][selectedSlot]}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SpellPreviewCard({ spell, source }: { spell: GeneratedSpell; source: "cogentlm" | "fallback" | null }) {
  return (
    <div className="spellPreview" style={{ borderColor: spell.color }}>
      <div className="spellPreviewHead">
        <span className="spellSwatch" style={{ background: spell.color }} aria-hidden />
        <div>
          <strong>{spell.element.toUpperCase()}</strong>
          <span>&middot; {spell.shape}</span>
        </div>
        {source ? <em className="spellPreviewSource">{source === "cogentlm" ? "CogentLM" : "Local Parser"}</em> : null}
      </div>

      <p className="spellbookCopy" style={{ marginTop: 8 }}>
        &ldquo;{spell.prompt}&rdquo;
      </p>

      <dl className="spellStats">
        <div><dt>Damage</dt><dd>{spell.damage}</dd></div>
        <div><dt>Speed</dt><dd>{spell.speed}</dd></div>
        <div><dt>Radius</dt><dd>{spell.radius.toFixed(1)}</dd></div>
        <div><dt>Duration</dt><dd>{(spell.durationMs / 1000).toFixed(1)}s</dd></div>
        <div><dt>Cooldown</dt><dd>{(spell.cooldownMs / 1000).toFixed(1)}s</dd></div>
        <div><dt>Mana</dt><dd>{spell.manaCost}</dd></div>
      </dl>

      {spell.effects.length > 0 ? (
        <div className="spellEffects">
          {spell.effects.map((effect) => (
            <span key={effect}>{effect.replace("_", " ")}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
