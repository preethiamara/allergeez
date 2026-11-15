"use client";
import { useState } from "react";
import type { Ingredient, Meal } from "@/lib/records";
import { allergenMatches } from "@/lib/allergens";
import { Icon } from "./ui";

/** Meal ingredients: add, remove, and flag the ones you suspect caused a reaction. */
export default function IngredientModal({ meal, allergens, onSave, onClose }: {
  meal: Meal;
  allergens: string[];
  onSave: (ingredients: Ingredient[]) => Promise<string | null>; // returns an error message, or null
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const list = meal.ingredients;

  async function save(next: Ingredient[]) {
    setBusy(true); setError("");
    const err = await onSave(next);
    setBusy(false);
    if (err) { setError(err); return false; }
    return true;
  }
  async function add() {
    const name = draft.trim();
    if (!name) return;
    if (list.some(i => i.name.toLowerCase() === name.toLowerCase())) { setError("That ingredient is already in this meal."); return; }
    if (await save([...list, { name, flagged: false }])) setDraft("");
  }
  const toggleFlag = (name: string) => save(list.map(i => (i.name === name ? { ...i, flagged: !i.flagged } : i)));
  const remove = (name: string) => save(list.filter(i => i.name !== name));
  const flaggedCount = list.filter(i => i.flagged).length;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ingredient-modal" role="dialog" aria-modal="true" aria-labelledby="ingredient-title" onMouseDown={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close ingredient details"><Icon name="close" /></button>
        <div className="ingredient-modal__icon"><Icon name="info" size={25} /></div>
        <p className="eyebrow">Meal ingredients</p>
        <h2 id="ingredient-title">{meal.name}</h2>

        <div className="ingredient-add">
          <label htmlFor="new-ingredient">Add an ingredient</label>
          <div>
            <input id="new-ingredient" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. sesame oil"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            <button onClick={add} disabled={busy || !draft.trim()}><Icon name="plus" size={16} /> Add</button>
          </div>
        </div>

        {list.length === 0 ? (
          <p className="ingredient-modal__note">No ingredients yet. Add what was in this meal so Gee can spot patterns.</p>
        ) : (
          <ul className="ingredient-list">
            {list.map(i => {
              const yours = allergens.some(a => allergenMatches(a, i.name));
              return (
                <li key={i.name} className={i.flagged ? "is-flagged" : ""}>
                  <span>{i.name}{yours && <em className="ingredient-yours">your allergen</em>}</span>
                  <button className={`ingredient-flag ${i.flagged ? "is-on" : ""}`} onClick={() => toggleFlag(i.name)} disabled={busy}
                    aria-pressed={i.flagged} aria-label={i.flagged ? `Unflag ${i.name}` : `Flag ${i.name} as a suspected trigger`}
                    title={i.flagged ? "Flagged as a suspected trigger" : "Flag as a suspected trigger"}>
                    <Icon name="flag" size={15} strokeWidth={2} />
                  </button>
                  <button className="ingredient-remove" onClick={() => remove(i.name)} disabled={busy} aria-label={`Remove ${i.name}`}><Icon name="close" size={15} /></button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="save-error">{error}</p>}
        <small className="ingredient-modal__note">
          {flaggedCount > 0 ? `${flaggedCount} flagged as a suspected trigger. ` : ""}
          Tap the flag on anything you think caused a reaction. Flagged ingredients show up on your Allergens page.
        </small>
      </section>
    </div>
  );
}
