# BiteSwift - Hệ Thống Đặt Đồ Ăn & Điều Phối Giao Hàng (Kiến Trúc Microservices)

BiteSwift là một ứng dụng giả lập đặt đồ ăn trực tuyến được thiết kế theo kiến trúc **Microservices** tiên tiến, đáp ứng đầy đủ và vượt trội các yêu cầu của **Đồ án phát triển ứng dụng Microservice (Chủ đề 4)**. Hệ thống sử dụng **RESTful API** cho giao tiếp đồng bộ, **RabbitMQ Message Queue** cho giao tiếp bất đồng bộ, kết nối các cơ sở dữ liệu riêng biệt cho từng dịch vụ và sở hữu giao diện giám sát thời gian thực cực kỳ trực quan (Live Monitoring Dashboard).

---

## 🏗️ Kiến Trúc Hệ Thống (System Architecture)

Hệ thống được chia thành **6 dịch vụ độc lập** chạy trên các cổng (Ports) riêng biệt:

1.  **API Gateway (Port 8000):** Cổng trung gian duy nhất tiếp nhận request từ Client. Thực hiện kiểm tra, giải mã JWT Token tập trung và định tuyến (routing) request xuống các dịch vụ con bên dưới.
2.  **User Service (Port 8001):** Quản lý tài khoản (Khách hàng, Nhà hàng, Tài xế). Mã hóa mật khẩu qua `bcrypt` và phát hành JWT Token. Cơ sở dữ liệu: **PostgreSQL** (`biteswift_user`).
3.  **Merchant Service (Port 8002):** Quản lý danh mục nhà hàng và thực đơn món ăn. Cơ sở dữ liệu: **MongoDB** (`biteswift_merchant`).
4.  **Order Service (Port 8003):** Tiếp nhận giỏ hàng, gọi REST API đồng bộ sang *Merchant Service* để kiểm tra giá và tính khả dụng của món ăn, lưu thông tin hóa đơn và bắn sự kiện `order.created` vào RabbitMQ. Cơ sở dữ liệu: **PostgreSQL** (`biteswift_order`).
5.  **Delivery Service (Port 8004) [Queue Consumer & Publisher]:** Tiêu thụ sự kiện `order.created` từ RabbitMQ. Bắt đầu tìm kiếm tài xế trống bằng cách gọi REST API sang *User Service*, giả lập các giai đoạn giao hàng của tài xế ảo qua các khoảng thời gian (delay) và bắn sự kiện `delivery.status_changed` lên RabbitMQ đồng thời cập nhật ngược trạng thái đơn hàng sang *Order Service* qua REST API. Cơ sở dữ liệu: **PostgreSQL** (`biteswift_delivery`).
6.  **Notification Service (Port 8005) [Queue Consumer & WebSocket Server]:** Lắng nghe toàn bộ sự kiện từ RabbitMQ (`order.created`, `delivery.status_changed`) và gom log tập trung từ các service qua HTTP POST, sau đó phát sóng (broadcast) thời gian thực đến các máy khách kết nối thông qua **Socket.io WebSockets**.
7.  **Frontend & Dashboard (Port 5173):** Giao diện Single Page Application (React + Vite + Vanilla CSS) chia làm 2 màn hình chính:
    *   **Customer Storefront:** Cho phép đăng nhập nhanh, duyệt quán ăn, thêm giỏ hàng, đặt món và theo dõi đơn hàng thời gian thực.
    *   **Live Admin Dashboard:** Trình giám sát hệ thống thời gian thực bao gồm Health Check trạng thái hoạt động các service con, màn hình gom Log hệ thống tập trung (Centralized Logs), và bản đồ mạng động Topology mô phỏng luồng di chuyển của message qua RabbitMQ.

---

## 🛠️ Yêu Cầu Cài Đặt (Prerequisites)

Hãy chắc chắn rằng máy tính của bạn đã cài đặt các phần mềm sau:
*   [Node.js](https://nodejs.org/) (Phiên bản >= 18.0.0)
*   [Docker](https://www.docker.com/) và [Docker Compose](https://docs.docker.com/compose/) (Để khởi chạy PostgreSQL, MongoDB và RabbitMQ)

---

## 🚀 Hướng Dẫn Khởi Chạy Hệ Thống (Quick Start)

Làm theo 3 bước đơn giản dưới đây để khởi chạy toàn bộ hệ thống monorepo BiteSwift:

### Bước 1: Khởi chạy Hạ tầng Docker (Postgres, MongoDB, RabbitMQ)
Mở một cửa sổ Terminal tại thư mục gốc của dự án và chạy lệnh sau để khởi động cơ sở dữ liệu và hàng đợi:
```bash
npm run dev:infra
```
*Lệnh này sẽ tải các container và chạy ngầm (-d). Quá trình khởi tạo lần đầu sẽ tự động chạy script `postgres-init/init-db.sh` để tạo 3 databases riêng biệt.*

> [!TIP]
> Bạn có thể truy cập trang quản trị RabbitMQ tại địa chỉ: [http://localhost:15672](http://localhost:15672) (Tài khoản: `guest` / Mật khẩu: `guest`) để xem trạng thái hàng đợi và các Exchanges trực quan.

### Bước 2: Cài Đặt Tất Cả Dependencies
Tại thư mục gốc của dự án, chạy lệnh dưới đây để tự động cài đặt thư viện cho toàn bộ 7 thư mục con (Workspaces) cùng một lúc:
```bash
npm run install:all
```

### Bước 3: Khởi Chạy Toàn Bộ Các Microservices & Frontend
Sau khi hạ tầng Docker đã chạy và dependencies đã được cài đặt hoàn tất, bạn chỉ cần chạy một lệnh duy nhất để khởi chạy **tất cả 6 service backend + 1 frontend** cùng lúc:
```bash
npm run dev
```

*   **Frontend Portal** sẽ chạy tại: [http://localhost:5173](http://localhost:5173)
*   **API Gateway** chạy tại: [http://localhost:8000](http://localhost:8000)

### Automated smoke test

Sau khi Docker infra và các service backend đã chạy, có thể kiểm tra nhanh health, CRUD mẫu và luồng checkout liên service bằng:

```bash
npm run test:smoke
```

Script này gọi qua API Gateway, tạo/sửa/xóa user, merchant, menu item, delivery job, tạo notification mẫu, và tạo một order thật để kích hoạt luồng `Order Service -> RabbitMQ -> Delivery/Notification Service`.

### Chạy toàn bộ bằng Docker Compose

Nếu muốn build và chạy cả frontend + toàn bộ microservice trong container độc lập:

```bash
npm run docker:apps
```

Dừng toàn bộ stack Docker:

```bash
npm run docker:apps:down
```

---

## 🚦 Kịch Bản Kiểm Thử & Chức Năng Nổi Bật (E2E Test Walkthrough)

Để chứng minh đồ án của bạn hoạt động hoàn hảo và liên mạch giữa các dịch vụ, hãy thực hiện kịch bản kiểm thử sau:

1.  **Đăng nhập tài khoản:**
    *   Mở trang web [http://localhost:5173](http://localhost:5173).
    *   Tại màn hình đăng nhập, hệ thống đã cung cấp nút **Đăng nhập nhanh** tiện lợi: Hãy click chọn **👥 Khách hàng mẫu: customer@biteswift.com** (Mật khẩu tự điền là `customer123`).
2.  **Kiểm tra Trạng thái Service (Health Checks):**
    *   Sau khi đăng nhập, click chọn tab **Live Dashboard** trên thanh Menu.
    *   Bạn sẽ thấy mục **Health Checks Radar** hiển thị dấu chấm Xanh lá **UP** cho toàn bộ 6 Services con, chứng minh tất cả đang chạy độc lập và hoạt động tốt.
3.  **Quan sát Gom Log Tập Trung (Centralized Logs):**
    *   Cũng tại tab **Live Dashboard**, nhìn sang ô **Log Hệ Thống Tập Trung**. Màn hình Terminal màu đen lúc này đang trống hoặc hiển thị dòng kết nối WebSocket.
4.  **Đặt đơn hàng mới (RESTful API & Sync check):**
    *   Quay lại tab **Món Ăn Ngon**.
    *   Click chọn nhà hàng **Cơm Tấm Phúc Lộc Thọ** -> Thực đơn món ăn hiện ra.
    *   Click **Thêm vào giỏ** đối với món *Cơm Tấm Sườn Bì Chả* (số lượng 2) và món *Nước Sâm La Hán Quả* (số lượng 1).
    *   Nhập địa chỉ giao hàng và click nút **Đặt Món Ngay (Checkout)**.
    *   *Tại thời điểm này, Order Service sẽ gửi REST API đồng bộ sang Merchant Service để kiểm tra giá và tính khả dụng của món ăn trước khi chấp nhận đơn hàng.*
5.  **Theo dõi sự kiện Asynchronous và Giao hàng (Message Queue):**
    *   Ngay khi đặt hàng thành công, màn hình sẽ tự động chuyển sang trạng thái theo dõi đơn hàng với trạng thái đầu tiên: **1. Chờ tài xế nhận đơn**.
    *   **Bật nhanh sang tab Live Dashboard** để quan sát hiện tượng cực kỳ ấn tượng:
        *   **Bản đồ luồng tin (Message Flow):** Một đường nét đứt sáng động sẽ chạy dọc theo sơ đồ: `Order Service` -> `RabbitMQ` -> phân nhánh sang `Delivery Service` và `Notification Service`!
        *   **Log Console:** Terminal sẽ liên tục in ra các dòng log gộp thời gian thực với màu sắc phân biệt rõ ràng:
            *   `[GATEWAY]` Tiếp nhận và chuyển tiếp request checkout.
            *   `[ORDER]` Lưu đơn hàng PENDING thành công vào database riêng.
            *   `[AMQP]` Bắn sự kiện `order.created` vào hàng đợi RabbitMQ.
            *   `[DELIVERY]` Lắng nghe thấy tin nhắn, tiến hành thuật toán tìm tài xế trống (chờ 3 giây).
            *   `[DELIVERY]` Khớp thành công tài xế *Trần Văn Tài Xế*, cập nhật DB riêng, bắn sự kiện `delivery.status_changed` sang RabbitMQ, gọi REST API ngược lại báo cho *Order Service* chuyển trạng thái đơn hàng sang `COOKING`.
            *   `[NOTIF]` Lắng nghe sự kiện tài xế, đẩy WebSockets lập tức về Frontend. Khách hàng thấy màn hình theo dõi tự chuyển sang bước **2. Tài xế nhận việc** mà không cần reload trang.
            *   *(Sau 5 giây)* `[DELIVERY]` Giả lập tài xế lấy đồ ăn thành công -> trạng thái đổi thành `PICKED_UP`. Khách hàng thấy bước **3. Đang giao hàng**.
            *   *(Sau 6 giây)* `[DELIVERY]` Giả lập tài xế giao tới nơi -> trạng thái đổi thành `DELIVERED`. Đơn hàng cập nhật thành `COMPLETED` trong Order Service. Khách hàng thấy bước **4. Đã hoàn thành**.
