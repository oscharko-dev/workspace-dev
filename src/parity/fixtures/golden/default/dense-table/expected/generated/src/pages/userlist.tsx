export default function UserList() {
  return (
    <main className="min-h-screen w-full flex flex-col min-h-[600px] w-full max-w-[800px] p-[16px] bg-[#ffffff]">
      <h1 data-ir-id="table-title" data-ir-name="Title" className="w-[100px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"Users"}</h1>
      <header data-ir-id="table-header" data-ir-name="Table Header" className="flex flex-row justify-between items-center min-h-[48px] w-full max-w-[768px] bg-[#f5f5f7]">
        <p data-ir-id="header-name" data-ir-name="Header Name" className="w-[180px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Name"}</p>
        <p data-ir-id="header-email" data-ir-name="Header Email" className="w-[200px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Email"}</p>
        <p data-ir-id="header-role" data-ir-name="Header Role" className="w-[140px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Role"}</p>
        <p data-ir-id="header-status" data-ir-name="Header Status" className="w-[168px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Status"}</p>
      </header>
      <table data-ir-id="table-row-1" data-ir-name="Table Row" className="flex flex-row justify-between items-center min-h-[52px] w-full max-w-[768px]">
        <p data-ir-id="row1-name" data-ir-name="Cell Name" className="w-[180px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"Alice Johnson"}</p>
        <p data-ir-id="row1-email" data-ir-name="Cell Email" className="w-[200px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"alice@example.com"}</p>
        <p data-ir-id="row1-role" data-ir-name="Cell Role" className="w-[140px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"Admin"}</p>
        <span data-ir-id="row1-status" data-ir-name="MuiChipRoot" className="relative min-h-[28px] w-[70px] bg-[#def5de] rounded-[14px]">
          <p data-ir-id="row1-status-text" data-ir-name="Label" className="absolute left-[10px] top-[6px] w-[50px] h-[16px] text-[12px] text-[#268026] leading-[16px] font-[500] text-center whitespace-pre-wrap">{"Active"}</p>
        </span>
      </table>
      <table data-ir-id="table-row-2" data-ir-name="Table Row" className="flex flex-row justify-between items-center min-h-[52px] w-full max-w-[768px]">
        <p data-ir-id="row2-name" data-ir-name="Cell Name" className="w-[180px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"Bob Smith"}</p>
        <p data-ir-id="row2-email" data-ir-name="Cell Email" className="w-[200px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"bob@example.com"}</p>
        <p data-ir-id="row2-role" data-ir-name="Cell Role" className="w-[140px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"Editor"}</p>
        <span data-ir-id="row2-status" data-ir-name="MuiChipRoot" className="relative min-h-[28px] w-[80px] bg-[#ffedd1] rounded-[14px]">
          <p data-ir-id="row2-status-text" data-ir-name="Label" className="absolute left-[8px] top-[6px] w-[56px] h-[16px] text-[12px] text-[#cc8000] leading-[16px] font-[500] text-center whitespace-pre-wrap">{"Pending"}</p>
        </span>
      </table>
    </main>
  );
}
