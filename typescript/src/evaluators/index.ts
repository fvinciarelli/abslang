export {
  evaluateStep,
  evaluateWithAdapter,
  registerAdapter,
  matchesSelector,
  ObservedStep,
  EvalResult,
  AdapterFunction,
} from "./builtin";

// Import built-in LLM judge (registers on import)
import "./builtin_judge";

export { configureAIEvaluator, getAIEvaluatorConfig } from "./adapters/aievaluator";
