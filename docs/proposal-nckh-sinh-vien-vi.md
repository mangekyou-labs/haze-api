# Đề cương Nghiên cứu Khoa học cấp Sinh viên

## Tên đề tài

**Cấp quyền truy cập API ẩn danh bằng bằng chứng không tiết lộ thông tin và giới hạn tốc độ mật học — nguyên mẫu cho trợ lý lập trình AI, mở rộng sang các API nhạy cảm về chiến lược**

> Tên tiếng Anh:
> *Anonymous API Access Credits using Zero-Knowledge Proofs and Cryptographic Rate Limiting — an MVP for AI Coding Agents, extensible to strategy-sensitive APIs*

---

## 1. Đặt vấn đề

### 1.1. Bối cảnh

Các dịch vụ API trả phí theo lượt gọi ngày càng phổ biến: trợ lý lập trình AI (Anthropic, OpenAI, Google), dữ liệu thị trường tài chính (Polygon.io, Alpha Vantage), phân tích chuỗi khối (Nansen, Glassnode, Dune), dữ liệu tài chính (Plaid). Mỗi lần gọi, nhà cung cấp đều ghi lại và liên kết với tài khoản người dùng qua API key hoặc tài khoản thanh toán.

Việc này tạo ra rủi ro về quyền riêng tư. **Mức độ rủi ro càng cao khi mẫu truy vấn càng nhạy cảm**:

| Loại API | Nhà cung cấp thấy gì | Rủi ro khi bị lộ |
|---|---|---|
| Trợ lý AI (Anthropic, OpenAI) | Mã nguồn, nội dung prompt | Cá nhân — lộ thói quen làm việc |
| Dữ liệu thị trường (Polygon, Alpha Vantage) | Mã cổ phiếu, thời điểm, tần suất truy vấn | **Lớn — lộ chiến lược giao dịch của quỹ đầu tư** |
| Phân tích chuỗi khối (Nansen, Glassnode) | Địa chỉ ví đang được điều tra | **Lớn — lộ thông tin điều tra** |
| Dữ liệu tín dụng / tài chính (Plaid) | Đối tượng được kiểm tra | Cao — lộ thông tin cạnh tranh |

Ví dụ: một quỹ đầu tư truy vấn cùng mã cổ phiếu trên nhiều nhà cung cấp dữ liệu cùng lúc sẽ **lộ chiến lược giao dịch** — đây là rò rỉ có giá trị đo bằng tiền, không phải vấn đề cá nhân. Đề tài bắt đầu từ trợ lý AI (dễ tiếp cận, có giao thức chung OpenAI) nhưng **bản chất giao thức không phụ thuộc loại API** — mở rộng sang các API tài chính là hướng tự nhiên và là nơi giá trị thực sự lớn.

### 1.2. Giải pháp hiện tại và hạn chế

| Giải pháp | Ưu điểm | Hạn chế |
|---|---|---|
| API key trực tiếp | Đơn giản | Mọi lần gọi đều liên kết với tài khoản |
| Dịch vụ gom API (OpenRouter, LiteLLM) | Tiện lợi, nhiều mô hình | Dịch vụ gom vẫn biết ai gọi gì |
| Thanh toán từng lần qua ví điện tử | Phi tập trung | Mỗi lần gọi là một giao dịch riêng, dễ đối chiếu |
| Nạp trước — dùng nhiều lần (MPP Channel) | Hiệu quả chi phí | Không ẩn danh giữa các lần gọi, không tịch thu cọc tự động khi quá hạn mức |

Chưa có giải pháp công khai nào cung cấp đồng thời: **(a) vào cửa dễ dàng cho người dùng thông thường, (b) ẩn danh danh tính người thanh toán với nhà cung cấp, và (c) giới hạn số lần gọi bằng mật học mà không thu thập danh tính — kèm cơ chế tịch thu cọc tự động khi vi phạm.**

### 1.3. Tính cấp thiết

Đề tài nằm ở giao diện mật học ứng dụng và blockchain — lĩnh vực ít sinh viên Việt Nam tiếp cận. Kết quả là một sản phẩm chạy được trên mạng thử nghiệm, đồng thời là tài liệu tham khảo về zero-knowledge proofs (bằng chứng không tiết lộ thông tin) áp dụng cho kiểm soát truy cập.

Đề tài cũng đặt nền móng cho hướng có giá trị thương mại: **cấp quyền truy cập ẩn danh cho API nhạy cảm về chiến lược** — nơi người mua có lý do cụ thể để trả thêm cho quyền riêng tư.

---

## 2. Mục tiêu nghiên cứu

### 2.1. Mục tiêu chính

1. **Xây dựng hợp đồng thông minh** (smart contract) trên blockchain cho phép:
   - Người dùng nạp tiền một lần, nhận một cam kết mật học (cryptographic commitment) đưa vào cây Merkle.
   - Mỗi lần gọi API, người dùng tạo một **bằng chứng không tiết lộ thông tin** (zero-knowledge proof) chứng minh cam kết tồn tại trong cây, nhưng không cho biết cam kết nào.
   - Hệ thống ghi một **nullifier** để chống gọi lại, nhưng nullifier không liên kết được với cam kết.

2. **Tích hợp cơ chế RLN (Rate-Limiting Nullifier):**
   - Giới hạn số lần gọi mỗi epoch (ví dụ 100 lần/ngày).
   - Khi gọi quá giới hạn, cơ chế mật học tự động **lộ khoá bí mật** → hệ thống **tịch thu tiền cọc** tự động, không cần bên thứ ba.

3. **Xây dựng cổng dịch vụ (gateway) tương thích giao thức OpenAI:**
   - Các trợ lý lập trình hiện có (Claude Code, Codex, v.v.) chỉ cần đổi biến môi trường `OPENAI_BASE_URL` là dùng được, không sửa mã nguồn.

### 2.2. Mục tiêu phụ

- Từ đăng nhập đến lần gọi API đầu tiên: **dưới 90 giây**.
- Độ trễ cộng thêm của gateway (khi đã có bằng chứng trong bộ nhớ đệm): **dưới 500 mili giây**.
- Sản phẩm chạy trên mạng thử nghiệm với tiền thử nghiệm (không dùng tiền thật).

### 2.3. Ngoài phạm vi

- Triển khai sản xuất với tiền thật.
- Ẩn danh địa chỉ IP (chỉ ẩn danh tầng thanh toán trong phiên bản này).
- Nhiều gateway đồng thời (cần mạng lưới đủ lớn, để sau).
- Người dùng tự mang khoá API (phá tính ẩn danh với nhà cung cấp đó).
- Tích hợp trực tiếp API tài chính (thuộc phiên bản sau — xem mục 14.2).

### 2.4. Lưu ý về phạm vi

Cơ chế cọc / bằng chứng / tịch thu cọc **không phụ thuộc loại API**. Cùng một mẫu (nạp tiền → nhận cam kết ẩn danh → gọi API qua gateway với bằng chứng ZK → giới hạn tốc độ bằng RLN → tịch thu cọc khi vi phạm) áp dụng được cho bất kỳ API trả phí nào mà **mẫu truy vấn là thông tin nhạy cảm**.

Phiên bản này giới hạn ở API trợ lý AI qua OpenRouter vì: (1) OpenRouter dùng chung một giao thức cho 400+ mô hình từ 70+ nhà cung cấp, nên một tích hợp là bao phủ hầu hết nhu cầu; (2) trợ lý lập trình AI dễ tiếp cận nhất cho nguyên mẫu; (3) demo dễ diễn giải với khán giả không chuyên.

---

## 3. Câu hỏi nghiên cứu

1. **RQ1:** Có thể thiết kế smart contract xác minh bằng chứng Groth16 trên đường cong BLS12-381 với độ trễ và chi phí khả thi cho mỗi lần gọi API không?
2. **RQ2:** Cơ chế RLN có thể thực thi giới hạn số lần gọi mà không thu thập danh tính, với việc lộ khoá bí mật khi vi phạm, hay không?
3. **RQ3:** Có thể xây gateway tương thích giao thức OpenAI sao cho người dùng chỉ cần đổi biến môi trường để sử dụng, mà không cần hiểu mật học hay blockchain?
4. **RQ4:** Hiệu suất sinh bằng chứng trong trình duyệt (WebAssembly) có đủ nhanh (~2–5 giây lần đầu, sau đó lưu bộ nhớ đệm) để trải nghiệm khả chấp?

---

## 4. Đối tượng và phạm vi

### 4.1. Đối tượng

- Bằng chứng không tiết lộ thông tin (Groth16 trên BLS12-381).
- Cơ chế giới hạn tốc độ bằng mật học RLN.
- Smart contract trên blockchain có hỗ trợ xác minh BLS12-381 gốc.
- Giao thức OpenAI Chat Completions (`/v1/chat/completions`).
- **Giao diện adapter nhà cung cấp:** lớp trừu tượng giữa gateway và nhà cung cấp API, cho phép thêm nhà cung cấp mới mà không sửa lớp bằng chứng hay hợp đồng.

### 4.2. Phạm vi

- **Blockchain:** Mạng thử nghiệm Stellar (hỗ trợ BLS12-381 từ giao thức 22+, theo CAP-0059). Chỉ dùng testnet, không dùng mainnet.
- **Ngôn ngữ hợp đồng:** Rust + `soroban-sdk`.
- **Công cụ mật học:** Circom + snarkjs (biên dịch với `-p bls12381`).
- **Gateway:** Node.js + Express + TypeScript.
- **Giao diện:** Next.js 14, đăng nhập GitHub OAuth, thanh toán thử nghiệm qua Stripe.
- **Adapter nhà cung cấp (v1):** OpenRouter — adapter duy nhất trong phiên bản này. Giao diện `ProviderAdapter` thiết kế tổng quát để thêm adapter sau (Polygon, Nansen, Glassnode) mà không động đến lớp bằng chứng hay hợp đồng.
- **Người dùng mục tiêu:** Sinh viên / lập trình viên cá nhân dùng trợ lý AI.

---

## 5. Tổng quan tài liệu

### 5.1. Bằng chứng không tiết lộ thông tin (Zero-Knowledge Proofs)

- Goldwasser, Micali & Rackoff (1985) — định nghĩa ZK proof.
- Groth (2016) — giao thức Groth16, hiệu quả, được dùng rộng rãi.
- Đường cong BLS12-381 (Boneh, Lynn, Shacham) — một số blockchain hỗ trợ xác minh gốc trong hợp đồng.

### 5.2. Cơ chế RLN (Rate-Limiting Nullifier)

- RLN ban đầu phát triển cho MACI / chống gian lận bảng phiếu (Ethereum Foundation).
- Ý tưởng: người dùng ký mỗi lần gọi bằng đa thức bậc một `y = a·x + b`, với `a = secret_k`, `b = Poseidon(secret_k, epoch)`. Hai chữ ký cùng `b` cho phép giải hệ phương trình suy ra `a` (khoá bí mật) → tịch thu cọc.

### 5.3. Cây Merkle và cam kết

- Merkle (1979) — cây băm xác minh thành viên tập dữ liệu lớn với chi phí logarit.
- Poseidon (Grassi et al., 2021) — hàm băm tối ưu cho mạch ZK.

### 5.4. Thanh toán máy-máy và API

- x402 (Coinbase, 2024) — trả tiền cho mỗi HTTP request.
- Machine Payments Protocol (Stellar Development Foundation, 2024) — chế độ "kênh" cho phép nạp một lần, dùng nhiều lần.
- OpenRouter — gom 400+ mô hình từ 70+ nhà cung cấp.

### 5.5. Khoảng trống nghiên cứu

Các công trình trên giải quyết từng phần (ZK, RLN, thanh toán máy-máy) nhưng chưa có tích hợp công khai: ZK + RLN + xác minh gốc trên hợp đồng + gateway tương thích OpenAI + vào cửa dễ dàng. Đề tài này lấp khoảng trống bằng một nguyên mẫu chạy được.

---

## 6. Phương pháp nghiên cứu

### 6.1. Design Science

Đề tài theo mô hình *design science research* (Hevner et al., 2004): xây dựng một sản phẩm phần mềm giải quyết bài toán cụ thể, đánh giá theo hiệu năng và tính đúng đắn.

### 6.2. Phân tích tài liệu

Đọc và tóm tắt tài liệu RLN, Groth16, CAP-0059, giao thức OpenAI Chat Completions để rút yêu cầu thiết kế.

### 6.3. Thực nghiệm

- Xây nguyên mẫu trên mạng thử nghiệm.
- Đo lường: thời gian sinh bằng chứng trong trình duyệt, độ trễ gateway, chi phí gas, thời gian từ đăng ký đến lần gọi đầu.
- Kiểm thử tấn công: gọi quá giới hạn → quan sát cơ chế lộ khoá và tịch thu cọc.

### 6.4. So sánh

So sánh với OpenRouter, LiteLLM, x402, MPP Channel theo tiêu chí: ẩn danh thanh toán, giới hạn tốc độ mật học, tịch thu cọc tự động, dễ vào cửa cho người dùng cuối.

---

## 7. Nội dung và nhiệm vụ

### 7.1. Gói 1 — Cơ sở lý thuyết

- Tổng quan ZK proofs (Groth16) và BLS12-381.
- Tổng quan RLN và ứng dụng giới hạn tốc độ ẩn danh.
- Tổng quan cây Merkle dùng Poseidon.
- Đọc CAP-0059 và `soroban-sdk` cho BLS12-381.

**Kết quả:** Báo cáo tổng quan ~15–20 trang.

### 7.2. Gói 2 — Mạch mật học (Circom)

Ba mạch, biên dịch với `-p bls12381`:

| Mạch | Ràng buộc chính | Đầu vào riêng | Đầu vào công khai |
|---|---|---|---|
| `deposit_membership.circom` | `Poseidon(sk) == commitment` ∧ thuộc cây Merkle | `secret_k`, đường đi Merkle | `root`, `commitment` |
| `rln_nullifier.circom` | Thuộc cây + `nullifier = Poseidon(sk, epoch)` + chia đa thức RLN | `secret_k`, đường đi Merkle | `root`, `epoch`, `nullifier`, `signal` |
| `slash.circom` | Hai chia cùng `b` → giải hệ → suy ra `secret_k` | — | `share1`, `share2`, `epoch`, `extracted_secret_k` |

- Sinh trusted setup (powers of tau + phase 2) cho thử nghiệm.
- Đo lường: số ràng buộc, thời gian sinh chứng minh trong trình duyệt.

**Kết quả:** Ba mạch Circom chạy được + báo cáo đo lường.

### 7.3. Gói 3 — Smart contract (Rust + Soroban)

- Hợp đồng `ZkCreditsContract`:
  - `deposit(depositor, commitment, amount)` — nạp tiền, thêm cam kết vào cây Merkle.
  - `spend(proof, {root, nullifier, signal, epoch})` — xác minh BLS12-381, kiểm tra nullifier chưa có, ghi nullifier.
  - `slash(slash_proof, {share1, share2, epoch, extracted_secret_k})` — tịch thu cọc, 50% vào quỹ, 50% cho người tố cáo.
  - `withdraw(commitment, recipient)` — rút tiền chưa dùng (yêu cầu bằng chứng sở hữu).
- Tích hợp bộ xác minh Groth16 BLS12-381 dùng `env.crypto().bls12_381()`.
- Kiểm thử đơn vị từng hàm; kiểm thử tích hợp toàn luồng.

**Kết quả:** Hợp đồng triển khai trên testnet + bộ kiểm thử.

### 7.4. Gói 4 — Gateway (Node.js)

- Gateway tương thích giao thức OpenAI: tiếp nhận `/v1/chat/completions`, chuyển tiếp tới OpenRouter.
- Nhận bằng chứng từ trình duyệt, xác minh nhanh ngoài hợp đồng (fast-path), sau đó nộp lên hợp đồng bất đồng bộ.
- Bộ nhớ đệm nullifier để từ chối nhanh các nullifier đã dùng.
- Theo dõi nullifier trùng → tự động nộp bằng chứng tịch thu.

**Kết quả:** Dịch vụ chạy cục bộ, xử lý được request từ Claude Code/Codex.

### 7.5. Gói 5 — Giao diện và vào cửa dễ dàng

- Next.js 14: đăng nhập GitHub OAuth, trang mua tín dụng (Stripe test mode), bảng điều khiển, trang onboarding.
- Trình duyệt sinh `secret_k` (WebCrypto), lưu IndexedDB, xuất mnemonic 12 từ để sao lưu.
- Trình duyệt sinh bằng chứng Groth16 qua WebAssembly.
- Đo lường: thời gian sinh bằng chứng, thời gian onboarding.

**Kết quả:** Giao diện chạy được, luồng end-to-end hoạt động.

### 7.6. Gói 6 — Tích hợp và đánh giá

- Chạy end-to-end: đăng nhập → mua tín dụng → chạy `claude` → nhận phản hồi thật.
- Kịch bản tấn công: gọi quá giới hạn → quan sát tịch thu cọc trong ~5 giây.
- So sánh với OpenRouter/LiteLLM/x402/MPP.
- Viết báo cáo tổng kết.

**Kết quả:** Báo cáo đánh giá + kịch bản demo 5 phút.

---

## 8. Kết quả dự kiến

1. **Sản phẩm chính:** Nguyên mẫu zk-api-credits chạy trên Stellar testnet, gồm:
   - 3 mạch Circom (BLS12-381) kèm bộ xác minh.
   - Smart contract `ZkCreditsContract` (Rust) trên testnet.
   - Gateway Node.js tương thích OpenAI.
   - Giao diện web Next.js với đăng nhập GitHub và thanh toán thử nghiệm.

2. **Báo cáo khoa học:**
   - Tổng quan cơ sở lý thuyết (ZK, RLN, cây Merkle, BLS12-381).
   - Mô tả thiết kế và lý do lựa chọn.
   - Kết quả đo lường: thời gian sinh bằng chứng, độ trễ, chi phí gas.
   - So sánh với giải pháp hiện có.
   - Hạn chế và hướng phát triển.

3. **Bộ dữ liệu đo lường:** số liệu hiệu năng cho các lần chạy thử nghiệm.

4. **Kịch bản demo 5 phút** trình bày tại hội nghị sinh viên.

---

## 9. Tính mới và đóng góp

### 9.1. Tính mới

- **Tích hợp chưa có công khai:** ZK-RLN + xác minh gốc trên BLS12-381 + gateway tương thích OpenAI + vào cửa dễ dàng (OAuth, thẻ tín dụng thử nghiệm).
- **Ứng dụng RLN cho giới hạn gọi API ẩn danh:** RLN thường dùng cho chống gian lận bảng phiếu; đề tài này mở sang kiểm soát truy cập dịch vụ AI.
- **Bối cảnh Việt Nam:** Ít đề tài sinh viên trong nước tiếp cận ZK ứng dụng; đề tài này là tài liệu tham khảo và nguyên mẫu mở.

### 9.2. Đóng góp khoa học

- Minh chứng thực nghiệm rằng xác minh BLS12-381 gốc trên smart contract khả thi cho trường hợp dùng thật (không chỉ số liệu lý thuyết).
- Đo lường hiệu năng sinh bằng chứng trong trình duyệt cho mạch RLN cỡ ~25k ràng buộc.

### 9.3. Đóng góp thực tiễn

- Nguyên mẫu mở có thể là điểm khởi đầu cho sản phẩm bảo mật quyền riêng tư cho lập trình viên Việt Nam.
- Tài liệu tiếng Việt hoá khái niệm ZK, RLN, nullifier cho sinh viên trong nước.
- Đặt nền móng cho hướng có giá trị thương mại: cấp quyền truy cập ẩn danh cho API nhạy cảm về chiến lược.

---

## 10. Lộ trình mở rộng và phương án tạo doanh thu

> Tham chiếu `docs/roadmap.md`. Phiên bản v1 (đề tài này) là MVP để chứng minh giao thức; tạo doanh thu nằm ở v2+ và là hướng phát triển, không phải kết quả của đề tài.

### 10.1. Bốn tầng mở rộng nhà cung cấp

| Tầng | Cơ chế | Độ phủ | Công sức | Lợi thế |
|---|---|---|---|---|
| **1 — qua OpenRouter** | Mọi mô hình OpenRouter thêm mới đều dùng được bằng cách đổi tên mô hình | ~95% nhu cầu API trợ lý AI | 0 (kế thừa danh mục OpenRouter) | Không có |
| **2 — quản trị chọn lọc** | Người dùng đề xuất → quản trị đánh giá → tích hợp adapter mới | API không trên OpenRouter (Polygon, Nansen, Glassnode) | 1–5 ngày mỗi tích hợp | **Cao** — đường duy nhất tới API đó dưới chế độ ẩn danh |
| **3 — người dùng tự mang khoá** | Người dùng dán khoá API của họ vào; gateway vẫn xác minh bằng chứng + giới hạn tốc độ | API tự host (vLLM), API nội bộ | Thấp | Khác — ẩn danh với gateway/nhà tuyển dụng, không phải với nhà cung cấp |
| **4 — nhà cung cấp tự tích hợp** | Nhà cung cấp tự tích hợp để tiếp cận người mua ẩn danh | Bất kỳ nhà cung cấp nào | Cao (cần SDK + giao diện tự phục vụ + mạng lưới) | **Rất cao** — giao thức trở thành nền tảng |

### 10.2. Bốn phương án tạo doanh thu

| Phương án | Mô hình | Khách hàng | Doanh thu | Ghi chú |
|---|---|---|---|---|
| **A — Gateway ẩn danh cho lập trình viên** | Thu 10–15% mỗi lần gọi + gói $5–10/tháng | Lập trình viên cá nhân | ~$10k–100k/tháng | Làm solo được, nhưng không lớn. OpenRouter có thể thêm "privacy mode" để cạnh tranh |
| **B — API nhạy cảm về chiến lược** | Thu 10–20% mỗi lần gọi ($0.01–1.00/lần) | Quỹ đầu tư, trading desk, công ty phân tích | ~$50k–500k/tháng | **Lợi thế mạnh nhất** — không thể gom bằng OpenRouter; cần xử lý điều khoản và KYC |
| **C — Bán bản quyền tự host** | Bán phần mềm cho tổ chức tự chạy | Tổ chức lớn, tư vấn, lab chính phủ | ~$50k–500k/hợp đồng | Phải bán hàng doanh nghiệp, không phải phát triển |
| **D — Tiêu chuẩn giao thức đa gateway** | Phí giao thức trên mỗi lần tịch thu + phí hosting + hỗ trợ | Nhiều gateway chia sẻ pool cọc | Cao nhưng chậm | 2–3 năm; rủi ro cao; nhiều khả năng vẫn là dự án nghiên cứu |

### 10.3. Tiến trình phát triển

```
v1 (MVP — đề tài này, ~14.5 ngày solo):
  API trợ lý AI qua OpenRouter (Tầng 1)
  → chứng minh giao thức, có người dùng thật, demo dễ

v2a (3–6 tháng):
  API tài chính/dữ liệu do quản trị chọn lọc (Tầng 2)
  → Polygon, Etherscan, Dune, Nansen, Glassnode
  → thu 10–20%, $0.01–1.00/lần
  → xử lý điều khoản và KYC theo từng nhà cung cấp

v2b (3–6 tháng, song song):
  Người dùng tự mang khoá (Tầng 3)
  → vLLM tự host, API nội bộ

v3 (6–12 tháng):
  Nhà cung cấp tự tích hợp (Tầng 4)
  → giao thức trở thành "chợ API ẩn danh"
  → đây là lúc lớn

v4 (12–24 tháng):
  Bán bản quyền tự host (Phương án C)

v5 (24–36 tháng):
  Tiêu chuẩn đa gateway (Phương án D)
  → ẩn danh liên gateway
  → giao thức trở thành nền tảng
```

### 10.4. Lưu ý trung thực

- Không xây "chợ nhà cung cấp" trong v1 — OpenRouter đã là chợ.
- Không xây Tầng 3 trong v1 — giá trị khác, làm loãng pitch v1.
- Không tuyên bố "trở thành OpenRouter của quyền riêng tư" — không gom được bằng OpenRouter. Pitch đúng: "lớp quyền riêng tư phía trên OpenRouter" (v1) và "kênh phân phối ẩn danh cho API nhạy cảm" (v2+).
- Không cam kết trước phương án doanh thu. Ship v1, xem ai dùng. Lập trình viên cá nhân → A. Tổ chức hỏi tự host → C. Gateway khác muốn chia sẻ pool cọc → D. **MVP cho biết phương án nào thật.**

---

## 11. Tiến độ (dự kiến 14 tuần)

| Tuần | Gói | Nội dung | Sản phẩm |
|---|---|---|---|
| 1–2 | 1 | Tổng quan tài liệu, CAP-0059, RLN, Groth16 | Báo cáo tổng quan |
| 3–4 | 2 | 3 mạch Circom, trusted setup, đo lường | Mạch + số liệu |
| 5–7 | 3 | Smart contract Soroban, bộ xác minh, kiểm thử | Hợp đồng trên testnet |
| 8–9 | 4 | Gateway Node.js, proxy OpenRouter, nullifier cache | Dịch vụ chạy cục bộ |
| 10–11 | 5 | Giao diện Next.js, trình duyệt sinh bằng chứng | Giao diện + crypto browser |
| 12 | 6 | Tích hợp end-to-end, kịch bản tấn công | Demo |
| 13 | 6 | Đo lường, so sánh, viết báo cáo | Báo cáo khoa học |
| 14 | — | Chuẩn bị thuyết trình, nộp báo cáo | Thuyết trình + báo cáo cuối |

---

## 12. Dự toán kinh phí

Chi phí **rất thấp** vì dùng mạng thử nghiệm và công cụ mã nguồn mở:

| Hạng mục | Chi phí | Ghi chú |
|---|---|---|
| Stellar testnet | 0 VNĐ | Miễn phí |
| USDC testnet | 0 VNĐ | Vòi thử nghiệm miễn phí |
| OpenRouter | ~200.000 VNĐ | Nạp tín dụng để gọi API thật khi demo (tùy chọn) |
| Hosting gateway (tùy chọn) | ~200.000 VNĐ/tháng | Fly.io hoặc Railway; có thể chạy cục bộ miễn phí |
| Tài liệu, sách | ~500.000 VNĐ | Sách mật học, in báo cáo |
| Tham dự hội nghị | ~1.000.000 VNĐ | Phí đăng ký, đi lại |
| **Tổng** | **~2.000.000 VNĐ** | Không kể thiết bị cá nhân |

> Nếu chỉ chạy cục bộ để báo cáo, tổng chi phí có thể dưới 500.000 VNĐ.

---

## 13. Sản phẩm và hình thức báo cáo

- **Báo cáo khoa học** (40–60 trang) theo mẫu trường/khoa.
- **Mã nguồn** công khai trên GitHub.
- **Kịch bản demo 5 phút** và video demo (tùy chọn).
- **Bài báo khoa học** nộp Hội nghị NCKH sinh viên cấp trường hoặc cấp bộ.

---

## 14. Hạn chế và hướng phát triển

### 14.1. Hạn chế (khai báo thành thật)

1. **Mô hình giữ hộ (custodial):** Tiền cọc do gateway giữ hộ; người dùng giữ `secret_k`. Gateway không thể tiêu tiền mà không có bằng chứng của người dùng (hợp đồng bắt buộc), nhưng nếu gateway mất thì người dùng cần đường rút độc lập (làm ở phiên bản sau).
2. **Tịch thu cọc có độ trễ:** Xác minh nhanh ngoài hợp đồng + nộp bất đồng bộ nghĩa là có cửa sổ ~5 giây mà kẻ tấn công có thể gọi lại trước khi nullifier được ghi. Tịch thu vẫn chạy, nhưng không tức thời.
3. **Chỉ một gateway:** Chưa có ẩn danh liên gateway vì chỉ có một cổng. Gateway có thể ghi nhật ký mẫu gọi (dù không liên kết được bằng mật học).
4. **Chỉ testnet:** Chưa chạy với tiền thật.
5. **Độ trễ sinh bằng chứng:** ~2–5 giây lần đầu, chấp nhận được cho demo.
6. **Chỉ ẩn danh tầng thanh toán:** Địa chỉ IP vẫn thấy. Ẩn danh tầng mạng (Tor, relay phía client) để sau.

### 14.2. Hướng phát triển (đồng bộ với `docs/roadmap.md`)

- **v2a — API nhạy cảm về chiến lược:** tích hợp adapter cho Polygon.io, Alpha Vantage, Nansen, Glassnode, Dune, Etherscan. Đây là nơi giá trị quyền riêng tư mạnh nhất. Cần xử lý điều khoản và KYC theo từng nhà cung cấp.
- **v2b — Người dùng tự mang khoá:** hỗ trợ vLLM tự host và API nội bộ. Giá trị khác — ẩn danh với gateway/nhà tuyển dụng.
- **v2 — Đường rút độc lập:** người dùng tự giữ tiền, không qua gateway.
- **v2 — Ẩn danh tầng mạng:** che địa chỉ IP, không chỉ thanh toán.
- **v3 — Nhà cung cấp tự tích hợp:** giao thức trở thành kênh phân phối — đây là lúc lớn.
- **v3 — Bằng chứng ZK cho điều kiện hạng giá:** ví dụ "đã chi > 1.000.000 đồng → được giảm giá" mà không tiết lộ danh tính.
- **v3 — Mainnet với tiền thật.**
- **v4 — Bán bản quyền tự host cho doanh nghiệp.**
- **v5 — Tiêu chuẩn đa gateway:** nhiều gateway chia sẻ pool cọc → ẩn danh liên gateway. 2–3 năm; rủi ro cao.

---

## 15. Tài liệu tham khảo

1. Goldwasser, S., Micali, S., & Rackoff, C. (1985). *The Knowledge Complexity of Interactive Proof-Systems.*
2. Groth, J. (2016). *On the Size of Pairing-based Non-interactive Arguments.* EUROCRYPT.
3. Grassi, L., Khovratovich, D., Rechberger, C., Roy, A., & Schofnegger, M. (2021). *Poseidon: A New Hash Function for Zero-Knowledge Proof Systems.* USENIX Security.
4. Merkle, R. C. (1979). *Securing Communications with Public Key Cryptosystems.*
5. Boneh, D., Lynn, B., & Shacham, H. (2001). *Short Signatures from the Weil Pairing.* ASIACRYPT.
6. Stellar Development Foundation. (2024). *CAP-0059: BLS12-381 Host Functions.*
7. Stellar Development Foundation. (2024). *Machine Payments Protocol (MPP).*
8. Coinbase. (2024). *x402: Enable Payments on HTTP 402.*
9. OpenRouter Documentation. https://openrouter.ai/docs
10. RLN Spec. https://rate-limiting-nullifier.github.io/rln-spec
11. Hevner, A. R., March, S. T., Park, J., & Ram, S. (2004). *Design Science in Information Systems Research.* MIS Quarterly.
12. Circom & snarkjs Documentation. https://docs.circom.io
13. soroban-sdk Rust Documentation. https://docs.rs/soroban-sdk
14. BIP-39 — *Mnemonic code for generating deterministic keys.*

---

## 16. Thông tin đề tài (mẫu điền)

| Mục | Nội dung |
|---|---|
| Cơ quan chủ quản | (tên trường) |
| Khoa / Viện | (tên khoa) |
| Bộ môn | (bộ môn) |
| Mã số đề tài | (cấp khi duyệt) |
| Chủ nhiệm | (họ tên sinh viên) |
| Lớp / Khóa | (lớp, khóa) |
| Giảng viên hướng dẫn | (họ tên, học hàm, học vị) |
| Loại đề tài | NCKH cấp sinh viên / trường / bộ |
| Thời gian | 14 tuần |
| Tổng kinh phí | ~2.000.000 VNĐ |
| Loại hình | Nghiên cứu ứng dụng — Design Science |
| Lĩnh vực | Mật học ứng dụng, Blockchain, Bảo mật và quyền riêng tư |
