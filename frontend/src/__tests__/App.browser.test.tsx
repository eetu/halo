import { render } from "vitest-browser-react";

import Root from "../Root";

describe("App", () => {
  test("renders without crashing", async () => {
    const screen = await render(<Root />);

    await expect.element(screen.getByRole("button", { name: "fullscreen" })).toBeVisible();
  });
});
