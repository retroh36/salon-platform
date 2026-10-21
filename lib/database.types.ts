
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
            "businesses": {
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
                },"locations": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"business_id": string,"city": string | null,"country": string,"created_at": string,"hours": NonNullable<Json>,"id": string,"name": string,"phone": string | null,"postal_code": string | null,"region": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id": string,"city"?: string | null,"country"?: string,"created_at"?: string,"hours"?: NonNullable<Json>,"id"?: string,"name": string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id"?: string,"city"?: string | null,"country"?: string,"created_at"?: string,"hours"?: NonNullable<Json>,"id"?: string,"name"?: string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone"?: string,"updated_at"?: string
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
                    "business_id": string,"color": string | null,"created_at": string,"email": string | null,"first_name": string,"id": string,"is_active": boolean,"last_name": string,"location_id": string,"phone": string | null,"role": Database["public"]['Enums']["staff_role"],"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"first_name": string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"location_id": string,"phone"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"first_name"?: string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"location_id"?: string,"phone"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "save_service":
{ Args: { "p_active_minutes": number,"p_business_id": string,"p_category": string,"p_description": string,"p_finishing_minutes": number,"p_name": string,"p_price_cents": number,"p_processing_minutes": number,"p_service_id": string,"p_staff": Json }; Returns: string
                           }
          }
          Enums: {
            "staff_role": "owner"|"manager"|"front_desk"|"stylist"
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
            "staff_role": ["owner", "manager", "front_desk", "stylist"]
          }
        }
} as const
