import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { 
  ShoppingBag, 
  MapPin, 
  Terminal as TerminalIcon, 
  Activity, 
  ChevronRight, 
  CheckCircle, 
  Truck, 
  Clock, 
  UtensilsCrossed, 
  LogOut, 
  User, 
  RefreshCw, 
  Send,
  Database,
  Sparkles
} from 'lucide-react';

// API Configuration - All routed through API Gateway (Port 8000)
const GATEWAY_URL = 'http://localhost:8000';
const NOTIFICATION_WS_URL = 'http://localhost:8005';

interface MenuItem {
  _id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  isAvailable: boolean;
}

interface Merchant {
  _id: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  image: string;
  menu: MenuItem[];
}

interface CartItem {
  item: MenuItem;
  quantity: number;
}

interface LogLine {
  service: string;
  message: string;
  timestamp: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'store' | 'dashboard'>('store');
  const [user, setUser] = useState<any>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('CUSTOMER');
  
  // Store state
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [address, setAddress] = useState('123 Đường Điện Biên Phủ, Quận Bình Thạnh, TP.HCM');
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [orderTrackingHistory, setOrderTrackingHistory] = useState<any[]>([]);

  // Logs terminal state
  const [logs, setLogs] = useState<LogLine[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Topology pulse animation states
  const [pulsePath, setPulsePath] = useState<string | null>(null);

  // Health checks state
  const [health, setHealth] = useState<Record<string, 'UP' | 'DOWN'>>({
    'API Gateway': 'DOWN',
    'User Service': 'DOWN',
    'Merchant Service': 'DOWN',
    'Order Service': 'DOWN',
    'Delivery Service': 'DOWN',
    'Notification Service': 'DOWN',
  });

  const socketRef = useRef<Socket | null>(null);

  // Auto-scroll logs terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Load User from LocalStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('biteswift_user');
    const savedToken = localStorage.getItem('biteswift_token');
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
    }
    
    // Fetch merchants catalog initially
    fetchMerchants();

    // Setup Health Checks interval (every 5 seconds)
    performHealthChecks();
    const healthInterval = setInterval(performHealthChecks, 5000);

    // Setup WebSocket connection to Notification Service
    setupWebSocket();

    return () => {
      clearInterval(healthInterval);
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const setupWebSocket = () => {
    console.log('Connecting to Notification WebSockets...');
    const socket = io(NOTIFICATION_WS_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to Notification WebSocket Server!');
      // Register this connection to receive Admin events
      socket.emit('join_admin');
      
      setLogs(prev => [...prev, {
        service: 'SYSTEM',
        message: 'Connected to WebSocket Server (Notification Service)',
        timestamp: new Date().toISOString()
      }]);
    });

    socket.on('system_log', (logPayload: LogLine) => {
      setLogs(prev => {
        // Keep logs capped at 150 lines to prevent memory bloat
        const newLogs = [...prev, logPayload];
        if (newLogs.length > 150) {
          newLogs.shift();
        }
        return newLogs;
      });
    });

    // Listen to queue messages for topological pulse animation wows
    socket.on('queue_message', (payload: any) => {
      const { routingKey } = payload;
      console.log('Consumed Queue Message via WS:', routingKey);
      
      // Animate SVG packet depending on message
      if (routingKey === 'order.created') {
        animatePulse('order-to-rabbitmq');
        // If it matches the current user active order, track it!
        if (activeOrder && activeOrder.id === payload.payload.orderId) {
          setOrderTrackingHistory(prev => [...prev, { status: 'PENDING', time: new Date() }]);
        }
      } else if (routingKey === 'delivery.status_changed') {
        const dStatus = payload.payload.status;
        animatePulse('delivery-to-rabbitmq');
        
        if (activeOrder && activeOrder.id === payload.payload.orderId) {
          setActiveOrder((prev: any) => ({
            ...prev,
            deliveryStatus: dStatus,
            driverName: payload.payload.driverName
          }));
          
          setOrderTrackingHistory(prev => [...prev, { 
            status: dStatus, 
            time: new Date(),
            driver: payload.payload.driverName 
          }]);
        }
      }
    });

    // Live active order status changes (specific room notifications)
    socket.on('order_update', (updatePayload: any) => {
      const { event, data } = updatePayload;
      if (event === 'delivery.status_changed') {
        setActiveOrder((prev: any) => {
          if (!prev || prev.id !== data.orderId) return prev;
          return {
            ...prev,
            deliveryStatus: data.status,
            driverName: data.driverName
          };
        });
      }
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Notification WebSockets.');
    });
  };

  const animatePulse = (pathId: string) => {
    setPulsePath(pathId);
    setTimeout(() => {
      setPulsePath(null);
    }, 1800); // Pulse duration
  };

  const performHealthChecks = async () => {
    const servicesToCheck = [
      { name: 'API Gateway', url: `${GATEWAY_URL}/health` },
      { name: 'User Service', url: `${GATEWAY_URL}/api/v1/auth/health` },
      { name: 'Merchant Service', url: `${GATEWAY_URL}/api/v1/merchants/health` },
      { name: 'Order Service', url: `${GATEWAY_URL}/api/v1/orders/health` },
      { name: 'Delivery Service', url: `${GATEWAY_URL}/api/v1/delivery/health` },
      { name: 'Notification Service', url: `${NOTIFICATION_WS_URL}/health` },
    ];

    const results: Record<string, 'UP' | 'DOWN'> = {};

    await Promise.all(
      servicesToCheck.map(async (service) => {
        try {
          const res = await axios.get(service.url, { timeout: 2000 });
          if (res.status === 200) {
            results[service.name] = 'UP';
          } else {
            results[service.name] = 'DOWN';
          }
        } catch (error) {
          results[service.name] = 'DOWN';
        }
      })
    );

    setHealth(results);
  };

  const fetchMerchants = async () => {
    try {
      const res = await axios.get(`${GATEWAY_URL}/api/v1/merchants`);
      setMerchants(res.data);
    } catch (error) {
      console.error('Error fetching merchants catalog:', error);
    }
  };

  // Auth Handler
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (authMode === 'login') {
        const res = await axios.post(`${GATEWAY_URL}/api/v1/auth/login`, { email, password });
        const { token, user } = res.data;
        localStorage.setItem('biteswift_token', token);
        localStorage.setItem('biteswift_user', JSON.stringify(user));
        setUser(user);
        
        setLogs(prev => [...prev, {
          service: 'SYSTEM',
          message: `User ${user.email} successfully logged in. Role: ${user.role}`,
          timestamp: new Date().toISOString()
        }]);
      } else {
        const res = await axios.post(`${GATEWAY_URL}/api/v1/auth/register`, { email, password, name, role });
        const { token, user: newUser } = res.data;
        localStorage.setItem('biteswift_token', token);
        localStorage.setItem('biteswift_user', JSON.stringify(newUser));
        setUser(newUser);

        setLogs(prev => [...prev, {
          service: 'SYSTEM',
          message: `New User registered: ${newUser.email}. Assigned Role: ${newUser.role}`,
          timestamp: new Date().toISOString()
        }]);
      }
      
      // Clear inputs
      setEmail('');
      setPassword('');
      setName('');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Authentication Failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('biteswift_token');
    localStorage.removeItem('biteswift_user');
    setUser(null);
    setCart([]);
    setSelectedMerchant(null);
    setActiveOrder(null);
  };

  // Direct login helpers for easy teacher evaluations!
  const loginQuickly = async (quickEmail: string, pass: string) => {
    try {
      const res = await axios.post(`${GATEWAY_URL}/api/v1/auth/login`, { email: quickEmail, password: pass });
      const { token, user } = res.data;
      localStorage.setItem('biteswift_token', token);
      localStorage.setItem('biteswift_user', JSON.stringify(user));
      setUser(user);
    } catch (err: any) {
      alert('Đăng nhập nhanh thất bại, hãy chắc chắn Docker Compose đã UP!');
    }
  };

  // Cart operations
  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.item._id === item._id);
      if (existing) {
        return prev.map(i => i.item._id === item._id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => prev.filter(i => i.item._id !== itemId));
  };

  const checkout = async () => {
    const token = localStorage.getItem('biteswift_token');
    if (!token) return alert('Vui lòng đăng nhập để đặt hàng!');

    const orderPayload = {
      address,
      items: cart.map(c => ({
        itemId: c.item._id,
        quantity: c.quantity
      }))
    };

    try {
      const res = await axios.post(`${GATEWAY_URL}/api/v1/orders`, orderPayload, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      const { order } = res.data;
      setActiveOrder({
        id: order.id,
        merchantName: order.merchant_name,
        totalPrice: order.total_price,
        deliveryStatus: 'SEARCHING',
        driverName: 'Đang tìm kiếm...',
        items: cart,
        address: order.address
      });

      // Clear Cart
      setCart([]);
      setSelectedMerchant(null);
      setOrderTrackingHistory([{ status: 'PENDING', time: new Date() }]);

      // Subscribe WebSocket to this specific order's notifications
      if (socketRef.current) {
        socketRef.current.emit('join_order', order.id.toString());
      }

      alert('Đặt hàng thành công! Đang chuyển sang màn hình theo dõi đơn hàng thời gian thực.');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Checkout failed. Make sure all backend services are running.');
    }
  };

  const getLogServiceClass = (service: string) => {
    switch (service.toUpperCase()) {
      case 'GATEWAY': return 'log-gateway';
      case 'USER':
      case 'USER-SERVICE': return 'log-user';
      case 'MERCHANT':
      case 'MERCHANT-SERVICE': return 'log-merchant';
      case 'ORDER':
      case 'ORDER-SERVICE': return 'log-order';
      case 'DELIVERY':
      case 'DELIVERY-SERVICE': return 'log-delivery';
      case 'RABBITMQ': return 'log-rabbitmq';
      default: return 'log-system';
    }
  };

  return (
    <div className="app-container">
      {/* HEADER NAV */}
      <header>
        <a href="#" className="logo" onClick={() => setActiveTab('store')}>
          <ShoppingBag size={24} style={{ color: 'var(--primary)' }} />
          <span>Bite</span>Swift
        </a>
        
        <div className="nav-tabs">
          <button 
            className={`nav-tab ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            <UtensilsCrossed size={16} />
            Món Ăn Ngon
          </button>
          <button 
            className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={16} />
            Live Dashboard
          </button>
        </div>

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Chào, <strong>{user.name}</strong> ({user.role})
            </span>
            <button className="btn btn-secondary" style={{ padding: '0.45rem 1rem' }} onClick={handleLogout}>
              <LogOut size={14} />
              Đăng xuất
            </button>
          </div>
        ) : (
          <div style={{ width: '80px' }} />
        )}
      </header>

      <div className="main-content">
        
        {/* TABS CONTAINER */}
        
        {/* TAB 1: STORE FRONTEND */}
        {activeTab === 'store' && (
          <div>
            {!user ? (
              // AUTHENTICATION BOX
              <div style={{ display: 'flex', justifyContent: 'center', margin: '4rem 0' }}>
                <div className="glass-card" style={{ width: '450px', padding: '2.5rem' }}>
                  <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      Chào mừng tới <span style={{ color: 'var(--primary)' }}>BiteSwift</span>
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                      Đặt đồ ăn chuẩn kiến trúc Microservices
                    </p>
                  </div>

                  <form onSubmit={handleAuth}>
                    {authMode === 'register' && (
                      <div className="form-group">
                        <label className="form-label">Họ và tên</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          placeholder="Nguyễn Văn A" 
                          value={name} 
                          onChange={(e) => setName(e.target.value)} 
                          required 
                        />
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Email đăng nhập</label>
                      <input 
                        type="email" 
                        className="form-input" 
                        placeholder="customer@biteswift.com" 
                        value={email} 
                        onChange={(e) => setEmail(e.target.value)} 
                        required 
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Mật khẩu</label>
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder="••••••••" 
                        value={password} 
                        onChange={(e) => setPassword(e.target.value)} 
                        required 
                      />
                    </div>
                    {authMode === 'register' && (
                      <div className="form-group">
                        <label className="form-label">Vai trò đăng ký</label>
                        <select className="form-input" value={role} onChange={(e) => setRole(e.target.value)}>
                          <option value="CUSTOMER">Khách hàng (Customer)</option>
                          <option value="MERCHANT">Chủ nhà hàng (Merchant)</option>
                          <option value="DRIVER">Tài xế giao hàng (Driver)</option>
                        </select>
                      </div>
                    )}

                    <button type="submit" className="btn" style={{ width: '100%', marginTop: '1.5rem' }}>
                      {authMode === 'login' ? 'Đăng Nhập' : 'Đăng Ký Tài Khoản'}
                    </button>
                  </form>

                  <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem' }}>
                    <a 
                      href="#" 
                      style={{ color: 'var(--primary)', textDecoration: 'none' }}
                      onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                    >
                      {authMode === 'login' ? 'Chưa có tài khoản? Đăng ký ngay' : 'Đã có tài khoản? Đăng nhập'}
                    </a>
                  </div>

                  {/* QUICK DEMO LOGIN BUTTONS */}
                  <div style={{ borderTop: '1px solid var(--border-glass)', marginTop: '2rem', paddingTop: '1.5rem' }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.75rem' }}>
                      ⚡ KHẢO SÁT NHANH ĐỒ ÁN (AUTO-FILL & LOGIN)
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <button 
                        onClick={() => loginQuickly('customer@biteswift.com', 'customer123')} 
                        className="btn btn-secondary" 
                        style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                      >
                        👥 Khách hàng mẫu: customer@biteswift.com
                      </button>
                      <button 
                        onClick={() => loginQuickly('merchant@biteswift.com', 'merchant123')} 
                        className="btn btn-secondary" 
                        style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                      >
                        🏪 Nhà hàng mẫu: merchant@biteswift.com
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            ) : (
              // MAIN PORTAL AFTER LOGIN
              <div className="storefront-grid">
                
                {/* LEFT: RESTAURANTS & MENUS */}
                <div>
                  {activeOrder ? (
                    // REAL-TIME ORDER TRACKER IF ACTIVE ORDER
                    <div className="glass-card" style={{ marginBottom: '2rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                        <div>
                          <span className="badge badge-info" style={{ marginBottom: '0.5rem' }}>ĐƠN HÀNG THỜI GIAN THỰC</span>
                          <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Mã đơn hàng: #{activeOrder.id}</h3>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Đặt tại: {activeOrder.merchantName}</p>
                        </div>
                        <button className="btn btn-secondary" onClick={() => setActiveOrder(null)}>
                          Đặt đơn mới
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                        <div>
                          <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Hành Trình Giao Hàng (Asynchronous Queue Flow)</h4>
                          
                          <div className="tracker-status-box">
                            <div className={`tracker-step ${['SEARCHING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'DELIVERED'].includes(activeOrder.deliveryStatus) ? 'active' : ''} ${activeOrder.deliveryStatus === 'SEARCHING' ? 'current' : ''}`}>
                              <div className="tracker-step-icon">
                                <RefreshCw size={14} />
                              </div>
                              <div>
                                <h5 style={{ fontSize: '0.9rem', fontWeight: 700 }}>1. Chờ tài xế nhận đơn</h5>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Hệ thống đang điều phối tài xế ảo trống gần quán ăn.</p>
                              </div>
                            </div>

                            <div className={`tracker-step ${['DRIVER_ASSIGNED', 'PICKED_UP', 'DELIVERED'].includes(activeOrder.deliveryStatus) ? 'active' : ''} ${activeOrder.deliveryStatus === 'DRIVER_ASSIGNED' ? 'current' : ''}`}>
                              <div className="tracker-step-icon">
                                <User size={14} />
                              </div>
                              <div>
                                <h5 style={{ fontSize: '0.9rem', fontWeight: 700 }}>2. Tài xế nhận việc</h5>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  Tài xế <strong>{activeOrder.driverName}</strong> đang di chuyển đến nhà hàng.
                                </p>
                              </div>
                            </div>

                            <div className={`tracker-step ${['PICKED_UP', 'DELIVERED'].includes(activeOrder.deliveryStatus) ? 'active' : ''} ${activeOrder.deliveryStatus === 'PICKED_UP' ? 'current' : ''}`}>
                              <div className="tracker-step-icon">
                                <Clock size={14} />
                              </div>
                              <div>
                                <h5 style={{ fontSize: '0.9rem', fontWeight: 700 }}>3. Đang giao hàng</h5>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tài xế đã lấy món, đang trên đường giao tới bạn.</p>
                              </div>
                            </div>

                            <div className={`tracker-step ${activeOrder.deliveryStatus === 'DELIVERED' ? 'active current' : ''}`}>
                              <div className="tracker-step-icon">
                                <CheckCircle size={14} />
                              </div>
                              <div>
                                <h5 style={{ fontSize: '0.9rem', fontWeight: 700 }}>4. Đã hoàn thành</h5>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Đơn hàng đã được giao thành công. Chúc ngon miệng!</p>
                              </div>
                            </div>
                          </div>

                          <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <h5 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                              Lich su su kien
                            </h5>
                            {orderTrackingHistory.slice(-5).map((event, index) => (
                              <div key={`${event.status}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-glass)', padding: '0.35rem 0' }}>
                                <span>{event.status}{event.driver ? ` - ${event.driver}` : ''}</span>
                                <span>{new Date(event.time).toLocaleTimeString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* ORDER DETAIL */}
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                          <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ShoppingBag size={16} />
                            Chi Tiết Đơn Hàng
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                            {activeOrder.items.map((cartItem: any) => (
                              <div key={cartItem.item._id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                <span>{cartItem.item.name} <strong style={{ color: 'var(--primary)' }}>x{cartItem.quantity}</strong></span>
                                <span>{(cartItem.item.price * cartItem.quantity).toLocaleString('vi-VN')} đ</span>
                              </div>
                            ))}
                          </div>
                          
                          <div style={{ borderTop: '1px solid var(--border-glass)', padding: '0.75rem 0', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                            <span>TỔNG TIỀN</span>
                            <span style={{ color: 'var(--primary)' }}>{activeOrder.totalPrice.toLocaleString('vi-VN')} đ</span>
                          </div>

                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem' }}>
                            <MapPin size={14} />
                            Địa chỉ giao hàng: {activeOrder.address}
                          </div>
                          
                          <div style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.08)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                            💡 <strong>Mẹo kiểm thử:</strong> Bật tab <strong>Live Dashboard</strong> bên trên để xem log chi tiết hành trình giao hàng chạy liên dịch vụ và bản đồ xung điện RabbitMQ theo thời gian thực!
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedMerchant ? (
                    // VIEW MENU OF SELECTED MERCHANT
                    <div className="glass-card">
                      <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}>
                        <img src={selectedMerchant.image} alt={selectedMerchant.name} style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '12px' }} />
                        <div>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', marginBottom: '0.5rem' }} onClick={() => setSelectedMerchant(null)}>
                            ← Quay lại
                          </button>
                          <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{selectedMerchant.name}</h2>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>{selectedMerchant.description}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <span>📍 {selectedMerchant.address}</span>
                            <span>📞 {selectedMerchant.phone}</span>
                          </div>
                        </div>
                      </div>

                      <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>Thực đơn của quán</h3>
                      
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {selectedMerchant.menu.map((dish) => (
                          <div key={dish._id} className="menu-item-card">
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                              <img src={dish.image} alt={dish.name} className="menu-item-img" />
                              <div>
                                <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>{dish.name}</h4>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem', maxWidth: '400px' }}>{dish.description}</p>
                                <span style={{ color: 'var(--primary)', fontWeight: 700, display: 'block', marginTop: '0.25rem' }}>
                                  {dish.price.toLocaleString('vi-VN')} đ
                                </span>
                              </div>
                            </div>
                            <button 
                              className="btn" 
                              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                              onClick={() => addToCart(dish)}
                              disabled={!dish.isAvailable}
                            >
                              {dish.isAvailable ? 'Thêm vào giỏ' : 'Hết hàng'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    // RESTAURANTS LIST
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <div>
                          <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Các Cửa Hàng Ẩm Thực</h2>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Đọc dữ liệu đồng bộ qua API Gateway từ Merchant Service (MongoDB)</p>
                        </div>
                        <button className="btn btn-secondary" style={{ padding: '0.5rem' }} onClick={fetchMerchants}>
                          <RefreshCw size={16} />
                        </button>
                      </div>

                      <div className="merchants-list">
                        {merchants.map((merchant) => (
                          <div 
                            key={merchant._id} 
                            className="glass-card merchant-card"
                            onClick={() => {
                              setSelectedMerchant(merchant);
                              // Auto clean cart if switching merchant (Standard rule)
                              setCart([]);
                            }}
                          >
                            <img src={merchant.image} alt={merchant.name} className="merchant-img" />
                            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{merchant.name}</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem', height: '40px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {merchant.description}
                            </p>
                            <div style={{ borderTop: '1px solid var(--border-glass)', marginTop: '1rem', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>📍 Bình Thạnh, TP.HCM</span>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                Xem Thực Đơn <ChevronRight size={14} />
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT: SHOPPING CART */}
                <div className="glass-card" style={{ height: 'fit-content', position: 'sticky', top: '100px' }}>
                  <h3 className="cart-title">
                    <ShoppingBag size={20} style={{ color: 'var(--primary)' }} />
                    Giỏ hàng của bạn
                  </h3>

                  {cart.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.9rem' }}>
                      Giỏ hàng trống.<br/>Chọn cửa hàng bên trái để chọn món ngon.
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '1rem' }}>
                        {cart.map((cartItem) => (
                          <div key={cartItem.item._id} className="cart-item">
                            <div>
                              <h4 style={{ fontWeight: 700, fontSize: '0.9rem' }}>{cartItem.item.name}</h4>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {cartItem.item.price.toLocaleString('vi-VN')} đ x {cartItem.quantity}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <span style={{ fontWeight: 700 }}>{(cartItem.item.price * cartItem.quantity).toLocaleString('vi-VN')} đ</span>
                              <button 
                                style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem' }}
                                onClick={() => removeFromCart(cartItem.item._id)}
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="form-group" style={{ marginTop: '1.25rem' }}>
                        <label className="form-label">
                          <MapPin size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                          Địa chỉ giao hàng
                        </label>
                        <textarea 
                          className="form-input" 
                          rows={2} 
                          value={address} 
                          onChange={(e) => setAddress(e.target.value)} 
                          style={{ resize: 'none' }}
                        />
                      </div>

                      <div className="cart-total">
                        <span>TỔNG CỘNG:</span>
                        <span style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>
                          {cart.reduce((acc, c) => acc + (c.item.price * c.quantity), 0).toLocaleString('vi-VN')} đ
                        </span>
                      </div>

                      <button className="btn" style={{ width: '100%' }} onClick={checkout}>
                        Đặt Món Ngay (Checkout)
                      </button>
                    </div>
                  )}

                </div>

              </div>
            )}
          </div>
        )}

        {/* TAB 2: LIVE MONITORING & TOPOLOGY DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-grid">
            
            {/* LEFT: NETWORK TOPOLOGY MAP */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Database size={20} style={{ color: 'var(--secondary)' }} />
                  Bản Đồ Phân Phối Tin Nhắn (Live System Flow)
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  Mô phỏng đường truyền tín hiệu đồng bộ (REST) và bất đồng bộ (RabbitMQ)
                </p>
              </div>

              {/* Topology canvas */}
              <div className="topology-container">
                {/* SVG Connections */}
                <svg className="topology-svg">
                  {/* Define paths for glowing flow animation */}
                  {/* Client to Gateway */}
                  <path id="client-to-gateway" d="M 110 200 L 160 200" className="topo-line" />
                  
                  {/* Gateway to Services */}
                  <path id="gateway-to-user" d="M 250 200 L 300 65" className="topo-line" />
                  <path id="gateway-to-merchant" d="M 250 200 L 300 155" className="topo-line" />
                  <path id="gateway-to-order" d="M 250 200 L 300 245" className="topo-line" />
                  
                  {/* Order to RabbitMQ */}
                  <path id="order-to-rabbitmq" d="M 390 245 L 450 200" className="topo-line" />
                  
                  {/* RabbitMQ to Delivery / Notif */}
                  <path id="rabbitmq-to-delivery" d="M 540 200 L 580 125" className="topo-line" />
                  <path id="rabbitmq-to-notif" d="M 540 200 L 580 275" className="topo-line" />
                  
                  {/* Delivery simulation back to Order & RabbitMQ */}
                  <path id="delivery-to-order" d="M 580 125 L 390 245" className="topo-line" />
                  <path id="delivery-to-rabbitmq" d="M 580 125 L 450 200" className="topo-line" />

                  {/* Active flow animations when triggered */}
                  {pulsePath && (
                    <use 
                      href={`#${pulsePath}`} 
                      className="topo-line-active"
                    />
                  )}
                </svg>

                {/* Topology Nodes */}
                {/* Node Client */}
                <div className="topo-node client">
                  <Sparkles className="topo-icon" size={18} />
                  <span>React Frontend</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 5173</span>
                </div>

                {/* Node Gateway */}
                <div className={`topo-node gateway ${health['API Gateway'] === 'UP' ? 'active-node' : ''}`}>
                  <Send className="topo-icon" size={18} />
                  <span>API Gateway</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 8000</span>
                </div>

                {/* Downstream services */}
                <div className={`topo-node user ${health['User Service'] === 'UP' ? 'active-node' : ''}`}>
                  <User className="topo-icon" size={18} />
                  <span>User Service</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 8001 (PG)</span>
                </div>

                <div className={`topo-node merchant ${health['Merchant Service'] === 'UP' ? 'active-node' : ''}`}>
                  <UtensilsCrossed className="topo-icon" size={18} />
                  <span>Merchant</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 8002 (MDB)</span>
                </div>

                <div className={`topo-node order ${health['Order Service'] === 'UP' ? 'active-node' : ''}`}>
                  <ShoppingBag className="topo-icon" size={18} />
                  <span>Order Service</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 8003 (PG)</span>
                </div>

                {/* RabbitMQ Broker */}
                <div className={`topo-node rabbitmq ${health['Order Service'] === 'UP' || health['Delivery Service'] === 'UP' ? 'active-node' : ''}`} style={{ width: '90px', height: '90px' }}>
                  <Database className="topo-icon" size={18} />
                  <span>RabbitMQ</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 5672</span>
                </div>

                {/* Async Consumers */}
                <div className={`topo-node delivery ${health['Delivery Service'] === 'UP' ? 'active-node' : ''}`}>
                  <Truck className="topo-icon" size={18} />
                  <span>Delivery</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 8004 (PG)</span>
                </div>

                <div className={`topo-node notif ${health['Notification Service'] === 'UP' ? 'active-node' : ''}`}>
                  <TerminalIcon className="topo-icon" size={18} />
                  <span>Notif (WS)</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Port: 8005</span>
                </div>

              </div>

              {/* HEALTH MONITOR PANEL */}
              <div style={{ marginTop: '1.5rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Trạng Thái Hoạt Động (Health Checks Radar)</span>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }} onClick={performHealthChecks}>
                    Kiểm tra lại
                  </button>
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {Object.entries(health).map(([serviceName, status]) => (
                    <div key={serviceName} style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}>
                      <span className={`health-pill ${status.toLowerCase()}`} />
                      <span style={{ fontWeight: 600, marginRight: '0.25rem' }}>{serviceName}:</span>
                      <span style={{ color: status === 'UP' ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                        {status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* RIGHT: CENTRALIZED SCROLLING LOG TERMINAL */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TerminalIcon size={20} style={{ color: 'var(--success)' }} />
                    Log Hệ Thống Tập Trung (Centralized Logs)
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Stream log thời gian thực từ tất cả các microservices qua WebSockets
                  </p>
                </div>
                <button className="btn btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }} onClick={() => setLogs([])}>
                  Xóa Log
                </button>
              </div>

              {/* Log Terminal Screen */}
              <div className="terminal">
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <span className="terminal-dot" style={{ backgroundColor: '#ef4444' }}></span>
                    <span className="terminal-dot" style={{ backgroundColor: '#f59e0b' }}></span>
                    <span className="terminal-dot" style={{ backgroundColor: '#10b981' }}></span>
                  </div>
                  <span>biteswift_aggregate_logs.log</span>
                  <span>UTF-8</span>
                </div>

                {logs.length === 0 ? (
                  <div style={{ color: '#475569', fontSize: '0.8rem', padding: '1rem', fontStyle: 'italic' }}>
                    Chưa có log sự kiện nào được ghi nhận.<br/>
                    (Mẹo: Đặt một đơn hàng bên tab "Món Ăn Ngon" để kích hoạt toàn bộ luồng log chạy song song của hệ thống!)
                  </div>
                ) : (
                  logs.map((line, idx) => (
                    <div key={idx} className="terminal-line">
                      <span style={{ color: '#475569', marginRight: '0.5rem' }}>
                        [{new Date(line.timestamp).toLocaleTimeString()}]
                      </span>
                      <span className={`${getLogServiceClass(line.service)}`} style={{ fontWeight: 700, marginRight: '0.5rem' }}>
                        [{line.service.toUpperCase()}]
                      </span>
                      <span style={{ color: '#e2e8f0' }}>{line.message}</span>
                    </div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* DEMO INFO TABLE */}
              <div style={{ marginTop: '1.25rem', fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.01)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                <p style={{ fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.25rem' }}>📌 Ý nghĩa màu sắc Log:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
                  <span><strong style={{ color: '#38bdf8' }}>[GATEWAY]</strong>: Log định tuyến API Gateway</span>
                  <span><strong style={{ color: '#4ade80' }}>[USER]</strong>: Log đăng ký / đăng nhập</span>
                  <span><strong style={{ color: '#facc15' }}>[MERCHANT]</strong>: Log danh mục / menu món</span>
                  <span><strong style={{ color: '#e879f9' }}>[ORDER]</strong>: Log đặt món (Sync REST check)</span>
                  <span><strong style={{ color: '#60a5fa' }}>[DELIVERY]</strong>: Log tài xế & mô phỏng giao hàng</span>
                  <span><strong style={{ color: '#f97316' }}>[RABBITMQ]</strong>: Sự kiện hàng đợi bất đồng bộ</span>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}
export {};
