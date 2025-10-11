# Smile-T Continental Hotel Backend API

## Base URL
```
https://smile-t-backend.onrender.com
```

## Authentication
Most endpoints require authentication via JWT token. Include the token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Staff Management Endpoints

### Staff Login
```http
POST /staff/login
```
Login for staff members.

**Request Body:**
```json
{
  "staff_id": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "jwt_token_string",
  "user": {
    "id": "string",
    "staff_id": "string",
    "name": "string",
    "role": "string"
  }
}
```

### Get All Staff
```http
GET /staff
```
Retrieve all staff members (requires superadmin role).

**Headers Required:**
- Authorization: Bearer token

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "name": "string",
      "staff_id": "string",
      "role": "string",
      "is_active": boolean
    }
  ]
}
```

### Create Staff
```http
POST /staff
```
Create a new staff member (requires superadmin role).

**Request Body:**
```json
{
  "name": "string",
  "staff_id": "string",
  "password": "string",
  "role": "string"
}
```

## Room Inventory Endpoints

### Get Available Rooms
```http
GET /room-inventory/available
```
Get all available rooms (public endpoint).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "room_type": "string",
      "price_per_night": number,
      "max_occupancy": number,
      "amenities": "string",
      "description": "string",
      "image": "string",
      "available_rooms": number,
      "total_rooms": number,
      "status": "string"
    }
  ]
}
```

### Check Room Availability
```http
GET /room-inventory/check-availability
```
Check availability for specific dates.

**Query Parameters:**
- room_type_id: string
- check_in: date (YYYY-MM-DD)
- check_out: date (YYYY-MM-DD)

**Response:**
```json
{
  "success": true,
  "available": boolean,
  "message": "string"
}
```

## Room Types
Available room types and their details:

- Classic Single (24,900/night)
  - Max occupancy: 2
  - Amenities: Breakfast, WiFi, gym, pool access
- Deluxe (30,500/night)
  - Max occupancy: 2
  - Amenities: Breakfast, WiFi, gym, pool access
- Deluxe Large (35,900/night)
  - Max occupancy: 2
  - Amenities: Breakfast, WiFi, gym, pool access
- Business Suite (49,900/night)
  - Max occupancy: 4
  - Amenities: Breakfast, WiFi, gym, pool access (2 guests)
- Executive Suite (54,900/night)
  - Max occupancy: 4
  - Amenities: Breakfast, WiFi, gym, pool access (2 guests)

## Booking Endpoints

### Create Booking
```http
POST /bookings
```
Create a new booking.

**Request Body:**
```json
{
  "guest_name": "string",
  "guest_email": "string",
  "guest_phone": "string",
  "room_type_id": "string",
  "check_in": "date",
  "check_out": "date",
  "number_of_guests": number,
  "special_requests": "string"
}
```

### Get Bookings
```http
GET /bookings
```
Get all bookings (requires authentication).

### Update Booking Status
```http
PUT /bookings/:id/status
```
Update booking status.

**Request Body:**
```json
{
  "status": "confirmed|cancelled|checked_in|checked_out"
}
```

## Bar Management Endpoints

### Get Drinks Inventory
```http
GET /drinks
```
Get all drinks in inventory.

### Add Drink
```http
POST /drinks
```
Add new drink to inventory.

**Request Body:**
```json
{
  "name": "string",
  "category": "string",
  "price": number,
  "quantity": number,
  "description": "string"
}
```

### Record Bar Sale
```http
POST /bar-sales
```
Record a new bar sale (requires superadmin or barman role).

**Request Body:**
```json
{
  "drink_id": "string",
  "quantity": number
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "drink_id": "string",
    "staff_id": "string",
    "staff_role": "superadmin|barman",
    "quantity": number,
    "amount": number,
    "drink_name": "string",
    "date": "timestamp"
  },
  "message": "Sale recorded successfully"
}
```

### Get Bar Sales
```http
GET /bar-sales
```
Get all bar sales (requires superadmin, supervisor, or barman role).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "drink_id": "string",
      "staff_id": "string",
      "staff_role": "superadmin|barman",
      "quantity": number,
      "amount": number,
      "drink_name": "string",
      "date": "timestamp",
      "staff": {
        "id": "string",
        "name": "string",
        "staff_id": "string",
        "role": "string"
      },
      "drinks": {
        "id": "string",
        "drink_name": "string",
        "price": number,
        "category": "string"
      }
    }
  ]
}
```

## Error Responses
All endpoints may return the following error responses:

```json
{
  "success": false,
  "message": "Error description"
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

## Rate Limiting
API requests are limited to 100 requests per 15 minutes per IP address.

## CORS
CORS is enabled for the following origins:
- https://www.smile-tcontinental.com
- https://smile-tcontinental.com
- http://localhost:3000
- http://localhost:5173

## Important Notes for Frontend Developers

1. Authentication:
   - Store the JWT token securely (preferably in httpOnly cookies)
   - Include the token in all authenticated requests
   - Token expires in 24 hours

2. Error Handling:
   - Always check the "success" boolean in responses
   - Handle 401 responses by redirecting to login
   - Implement retry logic for 500 errors

3. Performance Tips:
   - Cache room inventory responses (5-minute TTL)
   - Implement progressive loading for large lists
   - Use appropriate error boundaries

4. Development Setup:
   - Use the development URL: http://localhost:5000
   - Set CORS headers in development
   - Use environment variables for API URLs
