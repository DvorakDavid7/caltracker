import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../nutrition";

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    food: { type: "string" },
    grams: { type: "number" },
    kcal: { type: "number" },
    protein: { type: "number" },
    fat: { type: "number" },
    carbs: { type: "number" },
  },
  required: ["food", "grams", "kcal", "protein", "fat", "carbs"],
  additionalProperties: false,
} as const;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    items: { type: "array", items: ITEM_SCHEMA },
  },
  required: ["name", "items"],
  additionalProperties: false,
} as const;

let client: OpenAI | undefined;

export async function estimate(description: string): Promise<unknown> {
  if (!process.env.OPENAI_API_KEY) throw new Error("Chybí OPENAI_API_KEY v souboru .env");
  client ??= new OpenAI();

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    temperature: 0, // consistent estimates for the same input
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: description },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "nutrition", strict: true, schema: JSON_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("AI nevrátila žádnou odpověď");
  return JSON.parse(content);
}
