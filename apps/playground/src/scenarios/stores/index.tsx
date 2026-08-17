import { Section, Stack } from "@reactlens/demo-ui";
import { RoastFilter } from "./RoastFilter.js";
import { ReduxTasks } from "./ReduxTasks.js";
import { QueryStock } from "./QueryStock.js";
import { SingletonTheme } from "./SingletonTheme.js";

/**
 * External-store rewind, one card per shipped adapter. None of this state lives
 * in a hook, so without a registration the playhead would move the components
 * and leave every value below exactly where the live app left it.
 *
 *   RoastFilter     Zustand            setState(s, true)
 *   ReduxTasks      Redux Toolkit      withTimeTravel + hydrate action
 *   QueryStock      TanStack Query     dehydrate / clear + hydrate
 *   SingletonTheme  module singleton   createStoreAdapter
 */
export function Stores() {
  return (
    <Section
      kicker="Beyond hooks"
      title="External stores follow the playhead"
      hint="Each card registers one adapter through @reactlens/adapters. Change them all, then scrub back."
    >
      <Stack>
        <RoastFilter />
        <ReduxTasks />
        <QueryStock />
        <SingletonTheme />
      </Stack>
    </Section>
  );
}
