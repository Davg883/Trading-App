/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authz from "../authz.js";
import type * as brokerValidators from "../brokerValidators.js";
import type * as brokers from "../brokers.js";
import type * as consensus from "../consensus.js";
import type * as crons from "../crons.js";
import type * as defence from "../defence.js";
import type * as defenceValidators from "../defenceValidators.js";
import type * as earnings from "../earnings.js";
import type * as earningsValidators from "../earningsValidators.js";
import type * as evidenceChat from "../evidenceChat.js";
import type * as graph from "../graph.js";
import type * as http from "../http.js";
import type * as infrastructure from "../infrastructure.js";
import type * as infrastructureValidators from "../infrastructureValidators.js";
import type * as operations from "../operations.js";
import type * as operationsValidators from "../operationsValidators.js";
import type * as policyRisk from "../policyRisk.js";
import type * as portfolio from "../portfolio.js";
import type * as proofScale from "../proofScale.js";
import type * as proofValidators from "../proofValidators.js";
import type * as recovery from "../recovery.js";
import type * as remoteOpsCloud from "../remoteOpsCloud.js";
import type * as research from "../research.js";
import type * as reviewContext from "../reviewContext.js";
import type * as roles from "../roles.js";
import type * as server from "../server.js";
import type * as stress from "../stress.js";
import type * as trading from "../trading.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authz: typeof authz;
  brokerValidators: typeof brokerValidators;
  brokers: typeof brokers;
  consensus: typeof consensus;
  crons: typeof crons;
  defence: typeof defence;
  defenceValidators: typeof defenceValidators;
  earnings: typeof earnings;
  earningsValidators: typeof earningsValidators;
  evidenceChat: typeof evidenceChat;
  graph: typeof graph;
  http: typeof http;
  infrastructure: typeof infrastructure;
  infrastructureValidators: typeof infrastructureValidators;
  operations: typeof operations;
  operationsValidators: typeof operationsValidators;
  policyRisk: typeof policyRisk;
  portfolio: typeof portfolio;
  proofScale: typeof proofScale;
  proofValidators: typeof proofValidators;
  recovery: typeof recovery;
  remoteOpsCloud: typeof remoteOpsCloud;
  research: typeof research;
  reviewContext: typeof reviewContext;
  roles: typeof roles;
  server: typeof server;
  stress: typeof stress;
  trading: typeof trading;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
