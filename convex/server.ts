/** Schema-derived function bindings available before the first Convex deployment. */
import { queryGeneric, mutationGeneric, internalMutationGeneric } from 'convex/server';
import type { DataModelFromSchemaDefinition, QueryBuilder, MutationBuilder } from 'convex/server';
import type schema from './schema';
export type DataModel=DataModelFromSchemaDefinition<typeof schema>;
export type TableName=keyof DataModel;
export const query:QueryBuilder<DataModel,'public'>=queryGeneric;
export const mutation:MutationBuilder<DataModel,'public'>=mutationGeneric;
export const internalMutation:MutationBuilder<DataModel,'internal'>=internalMutationGeneric;
