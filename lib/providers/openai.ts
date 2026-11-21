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

const MENU_SCHEMA = {
  type: "object",
  properties: {
    notes: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          meals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                slot: { type: "string" },
                name: { type: "string" },
                prep: { type: "string" },
                items: { type: "array", items: ITEM_SCHEMA },
              },
              required: ["slot", "name", "prep", "items"],
              additionalProperties: false,
            },
          },
        },
        required: ["meals"],
        additionalProperties: false,
      },
    },
  },
  required: ["notes", "days"],
  additionalProperties: false,
} as const;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("Chybí OPENAI_API_KEY v souboru .env");
  client ??= new OpenAI();
  return client;
}

export async function planMenu(system: string, user: string): Promise<unknown> {
  const completion = await getClient().chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    max_completion_tokens: 32000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "menu", strict: true, schema: MENU_SCHEMA },
    },
  });

  const choice = completion.choices[0];
  if (choice?.finish_reason === "length") throw new Error("Odpověď AI byla useknutá");
  const content = choice?.message?.content;
  if (!content) throw new Error("AI nevrátila žádnou odpověď");
  return JSON.parse(content);
}

export async function estimate(description: string): Promise<unknown> {
  const client = getClient();

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
