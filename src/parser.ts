import artisan, {
  type Dictionary,
  type FeatureWeights,
  type LexicalProps,
} from "@textoic/artisan";
import type { ParsedToken } from "@textoic/enlint/types";

export type Parser = (text: string) => ParsedToken[][];

export type DictionaryEntries = [string, LexicalProps][];

export type StoredWeights = FeatureWeights | { weights?: FeatureWeights };

export type ParserData = {
  dictionary: DictionaryEntries;
  weights?: StoredWeights;
};

const unwrapped = (stored: StoredWeights = {}): FeatureWeights =>
  "weights" in stored && typeof stored.weights === "object"
    ? (stored.weights as FeatureWeights)
    : (stored as FeatureWeights);

export const createParser = ({ dictionary, weights }: ParserData): Parser => {
  const options = {
    dictionary: new Map(dictionary) as Dictionary,
    weights: unwrapped(weights),
  };
  return (text) => artisan(text, options) as unknown as ParsedToken[][];
};
