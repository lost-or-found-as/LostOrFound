"use strict";
// T1.9AJ: pet fields on a report. Only animals keep them (category PETS, not collars and leashes).
const ANIMAL_KEYS = new Set(["DOG", "CAT", "BIRD", "RABBIT", "SMALL_PET", "REPTILE", "HORSE", "OTHER_PET", "CUSTOM"]);
const TEMPERAMENTS = new Set(["SHY", "CALM"]);

function isAnimal(category, subcategoryKey) {
  return String(category || "").toUpperCase() === "PETS" && ANIMAL_KEYS.has(String(subcategoryKey || "").toUpperCase());
}

const clean = (value, max) => {
  const t = String(value ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

/** { pet_name, pet_breed, pet_temperament } for an animal; all null otherwise. Throws INVALID_PET_TEMPERAMENT. */
function normalizePet(category, subcategoryKey, input = {}) {
  if (!isAnimal(category, subcategoryKey)) return { pet_name: null, pet_breed: null, pet_temperament: null };
  const temperament = input.pet_temperament == null || input.pet_temperament === "" ? null : String(input.pet_temperament).toUpperCase();
  if (temperament && !TEMPERAMENTS.has(temperament)) throw codedError("INVALID_PET_TEMPERAMENT");
  return { pet_name: clean(input.pet_name, 40), pet_breed: clean(input.pet_breed, 60), pet_temperament: temperament };
}

module.exports = { ANIMAL_KEYS, isAnimal, normalizePet };
