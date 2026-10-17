import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { PageStateProvider, PageStateScope, usePageState, useResetPageState } from "../app/contexts/PageStateContext";
import { RememberedDetails } from "../app/components/RememberedDetails";

function Page() {
  const [draft, setDraft] = usePageState("draft", "");
  const [count, setCount] = usePageState("count", 0);
  const resetDraft = useResetPageState("draft");
  return <><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <RememberedDetails stateKey="tools"><summary>Tools</summary>Tools content</RememberedDetails>
    <button onClick={() => { setCount(value => value + 1); setCount(value => value + 1); }}>Count {count}</button>
    <button onClick={resetDraft}>Discard draft</button></>;
}
function ScopedPage() {
  const location = useLocation();
  return <PageStateScope name={location.pathname}><Page /></PageStateScope>;
}
function Navigation() {
  const navigate = useNavigate();
  return <><Link to="/a">Page A</Link><Link to="/b">Page B</Link><button onClick={() => navigate(-1)}>Back</button></>;
}
function Harness({owner = "first"}: {owner?: string}) {
  return <PageStateProvider key={owner}><MemoryRouter initialEntries={["/a"]}><Navigation /><Routes>
    <Route path="/a" element={<ScopedPage />} /><Route path="/b" element={<ScopedPage />} />
  </Routes></MemoryRouter></PageStateProvider>;
}

it("restores drafts and disclosure state after route unmounts, with separate state per page", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Draft"), {target: {value: "Page A draft"}});
  const disclosure = screen.getByText("Tools").closest("details")!;
  disclosure.open = true; fireEvent(disclosure, new Event("toggle"));
  fireEvent.click(screen.getByText("Count 0"));
  fireEvent.click(screen.getByText("Page B"));
  expect(screen.getByLabelText("Draft")).toHaveProperty("value", "");
  expect(screen.getByText("Tools").closest("details")).toHaveProperty("open", false);
  fireEvent.change(screen.getByLabelText("Draft"), {target: {value: "Page B draft"}});
  fireEvent.click(screen.getByText("Back"));
  expect(screen.getByLabelText("Draft")).toHaveProperty("value", "Page A draft");
  await waitFor(() => expect(screen.getByText("Tools").closest("details")).toHaveProperty("open", true));
  expect(screen.getByText("Count 2")).toBeTruthy();
  fireEvent.click(screen.getByText("Page B"));
  expect(screen.getByLabelText("Draft")).toHaveProperty("value", "Page B draft");
});

it("discards page state when the account session changes and when the app closes", () => {
  const {rerender, unmount} = render(<Harness />);
  fireEvent.change(screen.getByLabelText("Draft"), {target: {value: "Private draft"}});
  rerender(<Harness owner="second" />);
  expect(screen.getByLabelText("Draft")).toHaveProperty("value", "");
  rerender(<Harness owner="first" />);
  expect(screen.getByLabelText("Draft")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("Draft"), {target: {value: "New draft"}});
  unmount(); render(<Harness />);
  expect(screen.getByLabelText("Draft")).toHaveProperty("value", "");
});

it("keeps drafts in memory without writing them to local or session storage", () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Draft"), {target: {value: "Unsaved details"}});
  fireEvent.click(screen.getByText("Page B"));fireEvent.click(screen.getByText("Page A"));
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

it("resets a mounted draft without retaining discarded values or resetting other controls", () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Draft"),{target:{value:"Discard me"}});
  fireEvent.click(screen.getByText("Count 0"));
  fireEvent.click(screen.getByText("Discard draft"));
  expect(screen.getByLabelText("Draft")).toHaveProperty("value","");
  expect(screen.getByText("Count 2")).toBeTruthy();
  fireEvent.click(screen.getByText("Page B"));fireEvent.click(screen.getByText("Page A"));
  expect(screen.getByLabelText("Draft")).toHaveProperty("value","");
});

it("uses fresh server defaults when a discarded editor is opened again", () => {
  function Editor({initial}: {initial: string}) {
    const [value,setValue]=usePageState("editor.value",initial);
    const reset=useResetPageState("editor.");
    return <><input aria-label="Editor" value={value} onChange={e=>setValue(e.target.value)}/><button onClick={reset}>Discard editor</button></>;
  }
  function HarnessEditor({show,initial}: {show:boolean;initial:string}) {
    return <PageStateProvider>{show&&<Editor initial={initial}/>}</PageStateProvider>;
  }
  const {rerender}=render(<HarnessEditor show initial="First saved value"/>);
  fireEvent.change(screen.getByLabelText("Editor"),{target:{value:"Discard this draft"}});
  fireEvent.click(screen.getByText("Discard editor"));
  rerender(<HarnessEditor show={false} initial="Updated saved value"/>);
  rerender(<HarnessEditor show initial="Updated saved value"/>);
  expect(screen.getByLabelText("Editor")).toHaveProperty("value","Updated saved value");
});
