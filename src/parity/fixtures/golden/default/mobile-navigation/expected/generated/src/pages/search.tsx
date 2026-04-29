export default function Search() {
  return (
    <main className="min-h-screen w-full flex flex-col gap-[16px] min-h-[844px] w-full max-w-[390px] p-[16px] bg-[#ffffff]">
      <h1 data-ir-id="search-title" data-ir-name="Title" className="w-full max-w-[358px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"Search"}</h1>
      <input data-ir-id="search-field" data-ir-name="MuiFormControlRoot" className="flex flex-row justify-between items-center gap-[8px] min-h-[48px] w-full max-w-[358px]" type="text" name="muiFormControlRoot" aria-label="Search" />
    </main>
  );
}
