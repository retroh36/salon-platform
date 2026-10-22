
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_actions": {
                  Row: {
                    "business_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"feature": string,"id": string,"location_id": string,"previous_state": Json | null,"proposal": NonNullable<Json>,"proposed_by": string | null,"rank": number,"reason": string,"status": Database["public"]['Enums']["ai_action_status"],"subject": string | null,"summary": string,"undone_at": string | null,"undone_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"feature": string,"id"?: string,"location_id": string,"previous_state"?: Json | null,"proposal": NonNullable<Json>,"proposed_by"?: string | null,"rank"?: number,"reason": string,"status"?: Database["public"]['Enums']["ai_action_status"],"subject"?: string | null,"summary": string,"undone_at"?: string | null,"undone_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"feature"?: string,"id"?: string,"location_id"?: string,"previous_state"?: Json | null,"proposal"?: NonNullable<Json>,"proposed_by"?: string | null,"rank"?: number,"reason"?: string,"status"?: Database["public"]['Enums']["ai_action_status"],"subject"?: string | null,"summary"?: string,"undone_at"?: string | null,"undone_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_actions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_actions_decided_by_business_id_fkey"
      columns: ["decided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_proposed_by_business_id_fkey"
      columns: ["proposed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_undone_by_business_id_fkey"
      columns: ["undone_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_items": {
                  Row: {
                    "active_minutes": number,"appointment_id": string,"business_id": string,"created_at": string,"ends_at": string,"finishing_minutes": number,"id": string,"location_id": string,"price_cents": number,"processing_minutes": number,"resource_id": string | null,"service_id": string,"staff_id": string,"starts_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes": number,"appointment_id": string,"business_id": string,"created_at"?: string,"ends_at": string,"finishing_minutes"?: number,"id"?: string,"location_id": string,"price_cents": number,"processing_minutes"?: number,"resource_id"?: string | null,"service_id": string,"staff_id": string,"starts_at": string,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number,"appointment_id"?: string,"business_id"?: string,"created_at"?: string,"ends_at"?: string,"finishing_minutes"?: number,"id"?: string,"location_id"?: string,"price_cents"?: number,"processing_minutes"?: number,"resource_id"?: string | null,"service_id"?: string,"staff_id"?: string,"starts_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_items_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "appointment_items_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_items_resource_id_location_id_fkey"
      columns: ["resource_id","location_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id","location_id"]
    },{
      foreignKeyName: "appointment_items_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_items_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "business_id": string,"cancel_reason": string | null,"canceled_at": string | null,"client_id": string | null,"created_at": string,"created_by": string | null,"deposit_cents": number,"ends_at": string,"id": string,"location_id": string,"notes": string | null,"source": Database["public"]['Enums']["appointment_source"],"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"ends_at": string,"id"?: string,"location_id": string,"notes"?: string | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"ends_at"?: string,"id"?: string,"location_id"?: string,"notes"?: string | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_updated_by_business_id_fkey"
      columns: ["updated_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"plan": string,"settings": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"plan"?: string,"settings"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"plan"?: string,"settings"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"client_formulas": {
                  Row: {
                    "business_id": string,"client_id": string,"created_at": string,"formula": string,"id": string,"notes": string | null,"staff_id": string,"visit_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id": string,"created_at"?: string,"formula": string,"id"?: string,"notes"?: string | null,"staff_id": string,"visit_date"?: string
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string,"created_at"?: string,"formula"?: string,"id"?: string,"notes"?: string | null,"staff_id"?: string,"visit_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_formulas_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_formulas_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_formulas_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "allergies": string | null,"business_id": string,"consent_signed_on": string | null,"created_at": string,"email": string | null,"email_opt_in": boolean,"first_name": string,"id": string,"last_name": string,"notes": string | null,"phone": string | null,"phone_digits": string | null,"preferences": string | null,"preferred_staff_id": string | null,"search_name": string | null,"sms_opt_in": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergies"?: string | null,"business_id": string,"consent_signed_on"?: string | null,"created_at"?: string,"email"?: string | null,"email_opt_in"?: boolean,"first_name": string,"id"?: string,"last_name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"preferences"?: string | null,"preferred_staff_id"?: string | null,"search_name"?: never,"sms_opt_in"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "allergies"?: string | null,"business_id"?: string,"consent_signed_on"?: string | null,"created_at"?: string,"email"?: string | null,"email_opt_in"?: boolean,"first_name"?: string,"id"?: string,"last_name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"preferences"?: string | null,"preferred_staff_id"?: string | null,"search_name"?: never,"sms_opt_in"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_preferred_staff_id_business_id_fkey"
      columns: ["preferred_staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"import_external_ids": {
                  Row: {
                    "business_id": string,"entity": string,"external_id": string,"imported_at": string,"internal_id": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"entity": string,"external_id": string,"imported_at"?: string,"internal_id": string,"source": string
                  }
                  Update: {
                    "business_id"?: string,"entity"?: string,"external_id"?: string,"imported_at"?: string,"internal_id"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_external_ids_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"location_hours": {
                  Row: {
                    "business_id": string,"end_minute": number,"id": string,"location_id": string,"start_minute": number,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"end_minute": number,"id"?: string,"location_id": string,"start_minute": number,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"end_minute"?: number,"id"?: string,"location_id"?: string,"start_minute"?: number,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_hours_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"business_id": string,"calendar_version": number,"city": string | null,"country": string,"created_at": string,"id": string,"name": string,"phone": string | null,"postal_code": string | null,"region": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id": string,"calendar_version"?: number,"city"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"name": string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id"?: string,"calendar_version"?: number,"city"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"name"?: string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "ai_action_id": string | null,"appointment_id": string | null,"body": string,"business_id": string,"channel": string,"client_id": string | null,"created_at": string,"id": string,"location_id": string,"staff_id": string | null,"status": Database["public"]['Enums']["notification_status"],"template": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_action_id"?: string | null,"appointment_id"?: string | null,"body": string,"business_id": string,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"location_id": string,"staff_id"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"template": string,"updated_at"?: string
                  }
                  Update: {
                    "ai_action_id"?: string | null,"appointment_id"?: string | null,"body"?: string,"business_id"?: string,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"location_id"?: string,"staff_id"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"template"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_ai_action_id_fkey"
      columns: ["ai_action_id"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "notifications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "notifications_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "notifications_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "barcode": string | null,"brand": string,"business_id": string,"cost_cents": number,"created_at": string,"id": string,"is_active": boolean,"line": string | null,"name": string,"price_cents": number | null,"shelf": string | null,"size": number,"sku": string | null,"supplier_id": string | null,"type": Database["public"]['Enums']["product_type"],"unit": Database["public"]['Enums']["product_unit"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barcode"?: string | null,"brand": string,"business_id": string,"cost_cents"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"line"?: string | null,"name": string,"price_cents"?: number | null,"shelf"?: string | null,"size": number,"sku"?: string | null,"supplier_id"?: string | null,"type": Database["public"]['Enums']["product_type"],"unit": Database["public"]['Enums']["product_unit"],"updated_at"?: string
                  }
                  Update: {
                    "barcode"?: string | null,"brand"?: string,"business_id"?: string,"cost_cents"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"line"?: string | null,"name"?: string,"price_cents"?: number | null,"shelf"?: string | null,"size"?: number,"sku"?: string | null,"supplier_id"?: string | null,"type"?: Database["public"]['Enums']["product_type"],"unit"?: Database["public"]['Enums']["product_unit"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_business_id_fkey"
      columns: ["supplier_id","business_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"resources": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["resource_kind"],"location_id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["resource_kind"],"location_id": string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["resource_kind"],"location_id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resources_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"schedule_disruptions": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"created_at": string,"id": string,"item_id": string | null,"kind": Database["public"]['Enums']["disruption_kind"],"location_id": string,"minutes": number | null,"on_date": string,"reported_by": string | null,"resolved_by_action": string | null,"staff_id": string | null,"starts_at": string | null,"time_off_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"created_at"?: string,"id"?: string,"item_id"?: string | null,"kind": Database["public"]['Enums']["disruption_kind"],"location_id": string,"minutes"?: number | null,"on_date": string,"reported_by"?: string | null,"resolved_by_action"?: string | null,"staff_id"?: string | null,"starts_at"?: string | null,"time_off_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"created_at"?: string,"id"?: string,"item_id"?: string | null,"kind"?: Database["public"]['Enums']["disruption_kind"],"location_id"?: string,"minutes"?: number | null,"on_date"?: string,"reported_by"?: string | null,"resolved_by_action"?: string | null,"staff_id"?: string | null,"starts_at"?: string | null,"time_off_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_disruptions_appointment_id_business_id_location_i_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "schedule_disruptions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_reported_by_business_id_fkey"
      columns: ["reported_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_resolved_by_action_fkey"
      columns: ["resolved_by_action"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_time_off_id_fkey"
      columns: ["time_off_id"]
isOneToOne: false
      referencedRelation: "staff_time_off"
      referencedColumns: ["id"]
    }
                  ]
                },"services": {
                  Row: {
                    "active_minutes": number,"archived_at": string | null,"business_id": string,"category": string,"created_at": string,"description": string | null,"duration_minutes": number | null,"finishing_minutes": number,"id": string,"name": string,"price_cents": number,"processing_minutes": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes": number,"archived_at"?: string | null,"business_id": string,"category": string,"created_at"?: string,"description"?: string | null,"duration_minutes"?: never,"finishing_minutes"?: number,"id"?: string,"name": string,"price_cents": number,"processing_minutes"?: number,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number,"archived_at"?: string | null,"business_id"?: string,"category"?: string,"created_at"?: string,"description"?: string | null,"duration_minutes"?: never,"finishing_minutes"?: number,"id"?: string,"name"?: string,"price_cents"?: number,"processing_minutes"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "business_id": string,"color": string | null,"created_at": string,"email": string | null,"first_name": string,"id": string,"is_active": boolean,"last_name": string,"level": Database["public"]['Enums']["staff_level"] | null,"location_id": string,"phone": string | null,"role": Database["public"]['Enums']["staff_role"],"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"first_name": string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"level"?: Database["public"]['Enums']["staff_level"] | null,"location_id": string,"phone"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"first_name"?: string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"level"?: Database["public"]['Enums']["staff_level"] | null,"location_id"?: string,"phone"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_compensation": {
                  Row: {
                    "business_id": string,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_compensation_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_schedule_overrides": {
                  Row: {
                    "business_id": string,"created_at": string,"end_minute": number,"id": string,"on_date": string,"staff_id": string,"start_minute": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"end_minute": number,"id"?: string,"on_date": string,"staff_id": string,"start_minute": number
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"end_minute"?: number,"id"?: string,"on_date"?: string,"staff_id"?: string,"start_minute"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_schedule_overrides_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_services": {
                  Row: {
                    "business_id": string,"created_at": string,"price_cents": number | null,"service_id": string,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"price_cents"?: number | null,"service_id": string,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"price_cents"?: number | null,"service_id"?: string,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_services_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_services_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_time_off": {
                  Row: {
                    "business_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"end_minute": number | null,"ends_on": string,"id": string,"note": string | null,"reason": Database["public"]['Enums']["time_off_reason"],"requested_by": string,"staff_id": string,"start_minute": number | null,"starts_on": string,"status": Database["public"]['Enums']["time_off_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_minute"?: number | null,"ends_on": string,"id"?: string,"note"?: string | null,"reason": Database["public"]['Enums']["time_off_reason"],"requested_by": string,"staff_id": string,"start_minute"?: number | null,"starts_on": string,"status"?: Database["public"]['Enums']["time_off_status"],"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_minute"?: number | null,"ends_on"?: string,"id"?: string,"note"?: string | null,"reason"?: Database["public"]['Enums']["time_off_reason"],"requested_by"?: string,"staff_id"?: string,"start_minute"?: number | null,"starts_on"?: string,"status"?: Database["public"]['Enums']["time_off_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_time_off_decided_by_business_id_fkey"
      columns: ["decided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_time_off_requested_by_business_id_fkey"
      columns: ["requested_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_time_off_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_working_hours": {
                  Row: {
                    "business_id": string,"end_minute": number,"id": string,"staff_id": string,"start_minute": number,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"end_minute": number,"id"?: string,"staff_id": string,"start_minute": number,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"end_minute"?: number,"id"?: string,"staff_id"?: string,"start_minute"?: number,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_working_hours_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stock_levels": {
                  Row: {
                    "business_id": string,"id": string,"location_id": string,"on_hand": number,"product_id": string,"reorder_point": number,"reorder_quantity": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"location_id": string,"on_hand"?: number,"product_id": string,"reorder_point"?: number,"reorder_quantity"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"location_id"?: string,"on_hand"?: number,"product_id"?: string,"reorder_point"?: number,"reorder_quantity"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_levels_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_levels_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_levels_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "appointment_id": string | null,"appointment_item_id": string | null,"business_id": string,"change": number,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"note": string | null,"on_hand_after": number,"product_id": string,"reason": Database["public"]['Enums']["stock_reason"],"unit_cost_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"appointment_item_id"?: string | null,"business_id": string,"change": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"note"?: string | null,"on_hand_after": number,"product_id": string,"reason": Database["public"]['Enums']["stock_reason"],"unit_cost_cents"?: number | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"appointment_item_id"?: string | null,"business_id"?: string,"change"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"note"?: string | null,"on_hand_after"?: number,"product_id"?: string,"reason"?: Database["public"]['Enums']["stock_reason"],"unit_cost_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "account_number": string | null,"business_id": string,"created_at": string,"email": string | null,"id": string,"is_active": boolean,"lead_time_days": number,"name": string,"notes": string | null,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_number"?: string | null,"business_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"lead_time_days"?: number,"name": string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_number"?: string | null,"business_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"lead_time_days"?: number,"name"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "adjust_stock":
{ Args: { "p_change": number,"p_location_id": string,"p_note": string,"p_product_id": string,"p_reason": Database["public"]['Enums']["stock_reason"] }; Returns: number
                           },
"apply_ai_action":
{ Args: { "p_action_id": string,"p_client_id"?: string,"p_expected_version": number }; Returns: undefined
                           },
"record_ai_proposals":
{ Args: { "p_feature": string,"p_location_id": string,"p_options": Json,"p_subject": string }; Returns: (string)[]
                           },
"reject_ai_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"report_call_out":
{ Args: { "p_from": string,"p_staff_id": string }; Returns: string
                           },
"report_running_late":
{ Args: { "p_item_id": string,"p_minutes": number }; Returns: string
                           },
"save_appointment":
{ Args: { "p_appointment_id": string,"p_client_id": string,"p_expected_version": number,"p_items": Json,"p_location_id": string,"p_notes": string }; Returns: string
                           },
"save_service":
{ Args: { "p_active_minutes": number,"p_business_id": string,"p_category": string,"p_description": string,"p_finishing_minutes": number,"p_name": string,"p_price_cents": number,"p_processing_minutes": number,"p_service_id": string,"p_staff": Json }; Returns: string
                           },
"set_appointment_notes":
{ Args: { "p_appointment_id": string,"p_notes": string }; Returns: undefined
                           },
"set_appointment_status":
{ Args: { "p_appointment_id": string,"p_reason": string,"p_status": Database["public"]['Enums']["appointment_status"] }; Returns: undefined
                           },
"set_location_hours":
{ Args: { "p_business_id": string,"p_hours": Json,"p_location_id": string }; Returns: undefined
                           },
"set_staff_day_override":
{ Args: { "p_business_id": string,"p_hours": Json,"p_on_date": string,"p_staff_id": string }; Returns: undefined
                           },
"set_staff_weekly_hours":
{ Args: { "p_business_id": string,"p_hours": Json,"p_staff_id": string }; Returns: undefined
                           },
"set_stock_settings":
{ Args: { "p_location_id": string,"p_product_id": string,"p_reorder_point": number,"p_reorder_quantity": number }; Returns: undefined
                           },
"undo_ai_action":
{ Args: { "p_action_id": string,"p_expected_version": number }; Returns: undefined
                           }
          }
          Enums: {
            "ai_action_status": "proposed"|"approved"|"rejected"|"undone","appointment_source": "front_desk"|"phone"|"online"|"walk_in"|"import","appointment_status": "booked"|"confirmed"|"checked_in"|"completed"|"canceled"|"no_show","disruption_kind": "overrun"|"client_late"|"call_out","notification_status": "pending"|"sent"|"canceled","product_type": "retail"|"back_bar","product_unit": "g"|"ml"|"unit","resource_kind": "chair"|"room"|"station","staff_level": "junior"|"senior"|"master","staff_role": "owner"|"manager"|"front_desk"|"stylist","stock_reason": "service_use"|"sale"|"count"|"order_received"|"adjustment","time_off_reason": "vacation"|"sick"|"personal"|"other","time_off_status": "requested"|"approved"|"declined"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "ai_action_status": ["proposed", "approved", "rejected", "undone"],"appointment_source": ["front_desk", "phone", "online", "walk_in", "import"],"appointment_status": ["booked", "confirmed", "checked_in", "completed", "canceled", "no_show"],"disruption_kind": ["overrun", "client_late", "call_out"],"notification_status": ["pending", "sent", "canceled"],"product_type": ["retail", "back_bar"],"product_unit": ["g", "ml", "unit"],"resource_kind": ["chair", "room", "station"],"staff_level": ["junior", "senior", "master"],"staff_role": ["owner", "manager", "front_desk", "stylist"],"stock_reason": ["service_use", "sale", "count", "order_received", "adjustment"],"time_off_reason": ["vacation", "sick", "personal", "other"],"time_off_status": ["requested", "approved", "declined"]
          }
        }
} as const
