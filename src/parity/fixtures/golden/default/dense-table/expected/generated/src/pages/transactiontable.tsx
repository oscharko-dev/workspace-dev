export default function TransactionTable() {
  return (
    <main className="min-h-screen w-full flex flex-col min-h-[600px] w-full max-w-[800px] p-[16px] bg-[#ffffff]">
      <h1 data-ir-id="table-title" data-ir-name="Title" className="w-[100px] h-[32px] text-[24px] text-[#1c1f24] leading-[32px] font-[700] whitespace-pre-wrap">{"Transactions"}</h1>
      <header data-ir-id="table-header" data-ir-name="Table Header" className="flex flex-row justify-between items-center min-h-[48px] w-full max-w-[768px] bg-[#f5f5f7]">
        <p data-ir-id="header-name" data-ir-name="Header Payment ID" className="w-[180px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Payment ID"}</p>
        <p data-ir-id="header-email" data-ir-name="Header Counterparty" className="w-[200px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Counterparty"}</p>
        <p data-ir-id="header-role" data-ir-name="Header Amount" className="w-[140px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Amount"}</p>
        <p data-ir-id="header-status" data-ir-name="Header Status" className="w-[168px] h-[20px] text-[14px] text-[#666b75] leading-[20px] font-[600] whitespace-pre-wrap">{"Status"}</p>
      </header>
      <table data-ir-id="table-row-1" data-ir-name="Table Row" className="flex flex-row justify-between items-center min-h-[52px] w-full max-w-[768px]">
        <p data-ir-id="row1-name" data-ir-name="Cell Payment ID" className="w-[180px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"PAY-1042"}</p>
        <p data-ir-id="row1-email" data-ir-name="Cell Counterparty" className="w-[200px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"Demo Supplier A"}</p>
        <p data-ir-id="row1-role" data-ir-name="Cell Amount" className="w-[140px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"EUR 12,450"}</p>
        <span data-ir-id="row1-status" data-ir-name="Status Chip" className="relative min-h-[28px] w-[70px] bg-[#def5de] rounded-[14px]">
          <p data-ir-id="row1-status-text" data-ir-name="Label" className="absolute left-[10px] top-[6px] w-[50px] h-[16px] text-[12px] text-[#268026] leading-[16px] font-[500] text-center whitespace-pre-wrap">{"Cleared"}</p>
        </span>
      </table>
      <table data-ir-id="table-row-2" data-ir-name="Table Row" className="flex flex-row justify-between items-center min-h-[52px] w-full max-w-[768px]">
        <p data-ir-id="row2-name" data-ir-name="Cell Payment ID" className="w-[180px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"PAY-1043"}</p>
        <p data-ir-id="row2-email" data-ir-name="Cell Counterparty" className="w-[200px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"Demo Vendor B"}</p>
        <p data-ir-id="row2-role" data-ir-name="Cell Amount" className="w-[140px] h-[20px] text-[14px] text-[#1c1f24] leading-[20px] font-[400] whitespace-pre-wrap">{"EUR 8,910"}</p>
        <span data-ir-id="row2-status" data-ir-name="Status Chip" className="relative min-h-[28px] w-[80px] bg-[#ffedd1] rounded-[14px]">
          <p data-ir-id="row2-status-text" data-ir-name="Label" className="absolute left-[8px] top-[6px] w-[56px] h-[16px] text-[12px] text-[#cc8000] leading-[16px] font-[500] text-center whitespace-pre-wrap">{"Review"}</p>
        </span>
      </table>
    </main>
  );
}
