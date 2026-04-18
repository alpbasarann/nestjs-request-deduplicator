import { BaseState } from '../../base-state';
import type { ExistingRecordStateContext } from '../../state-context';

/**
 * Abstract intermediate for states that operate on a non-null existing record.
 * Fixes the generic `Ctx` to `ExistingRecordStateContext`, so concrete subclasses'
 * `handle` signature receives a guaranteed-present `existingRecord`.
 *
 * The factory dispatches this branch only when the adapter returned a record,
 * so there is no runtime null check or defensive assertion here.
 */
export abstract class ExistingRecordState extends BaseState<ExistingRecordStateContext> {}
